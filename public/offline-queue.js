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
    { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const name = prefix + accountBinding;
  return {
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
