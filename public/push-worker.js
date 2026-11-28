const cacheName = 'concept-offline-v2';
const offlinePage = new URL('offline.html', self.registration.scope);

self.addEventListener('install', (event) => event.waitUntil((async () => {
  await (await caches.open(cacheName)).add(offlinePage.href);
  await self.skipWaiting();
})()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key.startsWith('concept-offline-') && key !== cacheName)
    .map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.mode !== 'navigate' || !request.url.startsWith(self.registration.scope)) return;
  event.respondWith(fetch(request).catch(async () => (await caches.match(offlinePage.href)) ??
    new Response('The workspace is offline.', { status: 503 })));
});

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data?.json();
  } catch {
    return;
  }
  if (!data || typeof data.title !== 'string' || typeof data.body !== 'string') return;

  const icon = new URL('app-icon-192.png', self.registration.scope).href;
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    tag: data.tag,
    icon,
    badge: new URL('brand-mark.png', self.registration.scope).href,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('./#notifications', self.registration.scope);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) {
      await existing.navigate(url.href);
      await existing.focus();
    } else {
      await self.clients.openWindow(url.href);
    }
  })());
});
