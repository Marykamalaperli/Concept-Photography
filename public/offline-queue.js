const prefix = 'concept-offline-departure-';

export function hasSavedDeparture() {
  try {
    return Object.keys(localStorage).some((key) => key.startsWith(prefix));
  } catch {
    return false;
  }
}

export async function prepareDepartureStorage({ publicKey, accountBinding }) {
  const key = await crypto.subtle.importKey('spki', Uint8Array.from(atob(publicKey), (character) => character.charCodeAt(0)),
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt', 'wrapKey']);
  const name = prefix + accountBinding;
  return {
    work: offlineWorkStorage(key, accountBinding),
    load() {
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    async save(command) {
      const bytes = new TextEncoder().encode(JSON.stringify(command));
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, bytes));
      const encrypted = btoa(String.fromCharCode(...sealed));
      try {
        const existing = localStorage.getItem(name);
        if (existing) return existing;
        localStorage.setItem(name, encrypted);
      } catch {
        return null;
      }
      return encrypted;
    },
    remove(encrypted) {
      try {
        if (localStorage.getItem(name) === encrypted) localStorage.removeItem(name);
      } catch {
        // The server also deduplicates the report if storage could not be cleared.
      }
    },
  };
}

const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
export const offlineWorkForms = new Set(['profile/notes', 'hr/work-logs', 'hr/requests', 'operations/plan', 'task-draft']);

export function offlineWorkStorage(key, accountBinding) {
  const namespace = 'concept-offline-work-' + accountBinding + ':';
  const name = (id) => namespace + id;
  return {
    list() {
      try {
        return Object.keys(localStorage).filter((item) => item.startsWith(namespace)).map((item) => ({
          ...JSON.parse(localStorage.getItem(item)), id: item.slice(namespace.length),
        })).sort((a, b) => a.createdAt - b.createdAt);
      } catch {
        return [];
      }
    },
    async seal(path, data, employeeId) {
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const plain = new TextEncoder().encode(JSON.stringify({ id, createdAt, path, data, employeeId }));
      if (plain.byteLength > 21_500) throw new Error('This update is too large for offline saving.');
      const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const [wrapped, sealed] = await Promise.all([
        crypto.subtle.wrapKey('raw', aes, key, 'RSA-OAEP'),
        crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, plain),
      ]);
      return { id, createdAt, envelope: { wrappedKey: encode(wrapped), ciphertext: encode(sealed), iv: encode(iv) } };
    },
    save({ id, createdAt, envelope, blocked }) {
      localStorage.setItem(name(id), JSON.stringify({ createdAt, envelope, blocked }));
    },
    remove(id) { localStorage.removeItem(name(id)); },
  };
}
