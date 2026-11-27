const minute = 60_000;
const maxAttempts = 4;
const studioTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true,
});

class PushError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2000) throw new PushError('Invalid notification endpoint.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new PushError('Invalid notification endpoint.');
  }
  const host = url.hostname;
  const knownProvider = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
    host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
  if (!knownProvider || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) {
    throw new PushError('This browser’s notification service is unsupported.');
  }
  return url.href;
}

function subscriptionData(body) {
  const endpoint = pushEndpoint(body.endpoint);
  const p256dh = body.keys?.p256dh;
  const auth = body.keys?.auth;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' ||
      !/^B[A-Za-z0-9_-]{86}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) {
    throw new PushError('Invalid device notification keys.');
  }
  return { endpoint, p256dh, auth };
}

async function ensureKeys(db, webPush) {
  let keys = await db.get('SELECT vapid_public_key, vapid_private_key FROM push_settings WHERE id = 1');
  if (!keys?.vapid_public_key) {
    keys = await db.transaction(async (store) => {
      const current = await store.get('SELECT vapid_public_key, vapid_private_key FROM push_settings WHERE id = 1');
      if (current.vapid_public_key) return current;
      const generated = webPush.generateVAPIDKeys();
      return store.get(`
        UPDATE push_settings SET vapid_public_key = ?, vapid_private_key = ? WHERE id = 1
        RETURNING vapid_public_key, vapid_private_key
      `, generated.publicKey, generated.privateKey);
    });
  }
  return keys;
}

async function claimDue(db, now) {
  return db.transaction(async (store) => {
    await store.run(`
      INSERT INTO push_deliveries (task_id, employee_id, start_at, subscription_id, next_attempt_at)
      SELECT tasks.id, task_assignments.employee_id, tasks.start_at, push_subscriptions.id, ?
      FROM tasks
      JOIN task_assignments ON task_assignments.task_id = tasks.id
      JOIN employees ON employees.id = task_assignments.employee_id
      JOIN push_subscriptions ON push_subscriptions.employee_id = task_assignments.employee_id
      WHERE tasks.is_open = 0 AND tasks.shoot_status = 'booked' AND tasks.work_state = 'ready' AND tasks.completed_at IS NULL AND employees.archived = 0 AND employees.deactivated = 0
        AND tasks.start_at > ? AND tasks.start_at <= ?
      ON CONFLICT (task_id, employee_id, start_at, subscription_id) DO NOTHING
    `, now, now, now + 30 * minute);

    const due = await store.all(`
      SELECT d.task_id, d.employee_id, d.start_at, d.subscription_id, tasks.title, push_subscriptions.endpoint,
        push_subscriptions.p256dh, push_subscriptions.auth_secret
      FROM push_deliveries d
      JOIN tasks ON tasks.id = d.task_id AND tasks.start_at = d.start_at
      JOIN task_assignments ON task_assignments.task_id = d.task_id AND task_assignments.employee_id = d.employee_id
      JOIN employees ON employees.id = d.employee_id
      JOIN push_subscriptions ON push_subscriptions.id = d.subscription_id AND push_subscriptions.employee_id = d.employee_id
      WHERE d.sent_at IS NULL AND d.attempts < ? AND d.next_attempt_at <= ?
        AND d.start_at > ? AND tasks.is_open = 0 AND tasks.shoot_status = 'booked' AND tasks.work_state = 'ready' AND tasks.completed_at IS NULL
        AND employees.archived = 0 AND employees.deactivated = 0
      ORDER BY d.start_at, d.attempts, d.subscription_id LIMIT 50
    `, maxAttempts, now, now);
    for (const delivery of due) {
      await store.run(`
        UPDATE push_deliveries SET attempts = attempts + 1, next_attempt_at = ?
        WHERE task_id = ? AND employee_id = ? AND start_at = ? AND subscription_id = ?
      `, now + 2 * minute, delivery.task_id, delivery.employee_id, delivery.start_at, delivery.subscription_id);
    }
    await store.run('DELETE FROM push_deliveries WHERE start_at < ?', now - 24 * 60 * minute);
    return due;
  });
}

export function createMobilePush(webPush, subject, fetchPush = fetch) {
  async function deliver(keys, subscription, payload, ttl) {
    const request = webPush.generateRequestDetails(
      { endpoint: pushEndpoint(subscription.endpoint), keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret } },
      JSON.stringify(payload),
      {
        TTL: ttl, urgency: 'high',
        vapidDetails: { subject, publicKey: keys.vapid_public_key, privateKey: keys.vapid_private_key },
      },
    );
    const response = await fetchPush(request.endpoint, {
      method: request.method, headers: request.headers,
      body: request.body, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    await response.body?.cancel();
    return response;
  }

  async function send(db, keys, delivery) {
    const now = Date.now();
    if (delivery.start_at <= now) return;
    const payload = {
      title: 'Concept Photography',
      body: `${delivery.title} starts at ${studioTime.format(delivery.start_at)} IST.`,
      tag: `concept-shoot-${delivery.task_id}-${delivery.start_at}`,
    };
    try {
      const response = await deliver(keys, delivery, payload, Math.max(1, Math.ceil((delivery.start_at - now) / 1000)));
      if (response.ok) {
        await db.run(`
          UPDATE push_deliveries SET sent_at = ?
          WHERE task_id = ? AND employee_id = ? AND start_at = ? AND subscription_id = ?
        `, Date.now(), delivery.task_id, delivery.employee_id, delivery.start_at, delivery.subscription_id);
      } else if (response.status === 404 || response.status === 410) {
        await db.run('DELETE FROM push_subscriptions WHERE id = ? AND employee_id = ?', delivery.subscription_id, delivery.employee_id);
      } else if (response.status < 500 && response.status !== 429) {
        await db.run(`
          UPDATE push_deliveries SET attempts = ?
          WHERE task_id = ? AND employee_id = ? AND start_at = ? AND subscription_id = ?
        `, maxAttempts, delivery.task_id, delivery.employee_id, delivery.start_at, delivery.subscription_id);
      }
    } catch {
      // The scheduled retry will pick up transient network or delivery failures.
    }
  }

  return {
    async key(db) {
      const keys = await ensureKeys(db, webPush);
      return { publicKey: keys.vapid_public_key };
    },

    async status(db, employeeId, endpoint) {
      const record = await db.get('SELECT id FROM push_subscriptions WHERE employee_id = ? AND endpoint = ?', employeeId, pushEndpoint(endpoint));
      return { enabled: Boolean(record) };
    },

    async register(db, employeeId, body) {
      const { endpoint, p256dh, auth } = subscriptionData(body);
      return db.transaction(async (store) => {
        await store.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND employee_id != ?', endpoint, employeeId);
        await store.run(`
          INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth_secret) VALUES (?, ?, ?, ?)
          ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth_secret = excluded.auth_secret
        `, employeeId, endpoint, p256dh, auth);
        return { enabled: true };
      });
    },

    async remove(db, employeeId, endpoint) {
      await db.run('DELETE FROM push_subscriptions WHERE employee_id = ? AND endpoint = ?', employeeId, pushEndpoint(endpoint));
      return { enabled: false };
    },

    async testDevice(db, employeeId, value) {
      const endpoint = pushEndpoint(value);
      const now = Date.now();
      const subscription = await db.get(`
        UPDATE push_subscriptions SET last_test_at = ?
        WHERE employee_id = ? AND endpoint = ? AND (last_test_at IS NULL OR last_test_at <= ?)
        RETURNING id, endpoint, p256dh, auth_secret
      `, now, employeeId, endpoint, now - minute);
      if (!subscription) {
        const existing = await db.get('SELECT id FROM push_subscriptions WHERE employee_id = ? AND endpoint = ?', employeeId, endpoint);
        if (existing) throw new PushError('Wait one minute between test reminders.', 429);
        throw new PushError('Enable mobile alerts on this device first.', 409);
      }
      const keys = await ensureKeys(db, webPush);
      let response;
      try {
        response = await deliver(keys, subscription, {
          title: 'Concept Photography',
          body: 'This is a test reminder from your workspace.',
          tag: 'concept-device-test',
        }, 60);
      } catch {
        throw new PushError('The notification service could not be reached. Try again in a minute.', 503);
      }
      if (response.ok) return { ok: true };
      if (response.status === 404 || response.status === 410) {
        await db.run('DELETE FROM push_subscriptions WHERE id = ? AND employee_id = ?', subscription.id, employeeId);
        throw new PushError('This device’s alert subscription expired. Enable mobile alerts again.', 410);
      }
      throw new PushError('The notification service could not accept the test. Try again in a minute.', 503);
    },

    async dispatch(db) {
      const now = Date.now();
      const deliveries = await claimDue(db, now);
      if (!deliveries.length) return { processed: 0 };
      const keys = await ensureKeys(db, webPush);
      for (let offset = 0; offset < deliveries.length; offset += 10) {
        await Promise.all(deliveries.slice(offset, offset + 10).map((delivery) => send(db, keys, delivery)));
      }
      return { processed: deliveries.length };
    },
  };
}
