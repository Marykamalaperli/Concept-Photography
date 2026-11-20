const scope = new URL('./', import.meta.url).href;

export function needsHomeScreen() {
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return appleMobile && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches;
}

export function supportsMobileAlerts() {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function preparePushWorker() {
  await navigator.serviceWorker.register(new URL('push-worker.js', scope), { scope });
  return navigator.serviceWorker.ready;
}

export async function currentPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration(scope);
    return registration?.scope === scope ? await registration.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

export async function subscribeToMobileAlerts(registration, publicKey) {
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Allow notifications in your browser or device settings, then try again.');
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}
