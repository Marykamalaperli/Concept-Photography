import { siteCoordinates } from './attendance-policy.js';

const googleHosts = new Set(['www.google.com', 'google.com', 'maps.google.com', 'www.google.co.in', 'maps.google.co.in']);
const shortHosts = new Set(['maps.app.goo.gl', 'goo.gl']);
const pair = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

function mapsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Paste a valid Google Maps link.');
  }
  const { hostname, pathname } = url;
  const direct = googleHosts.has(hostname) &&
    (pathname === '/maps' || pathname.startsWith('/maps/') || (hostname.startsWith('maps.') && pathname === '/'));
  const short = shortHosts.has(hostname) && (hostname !== 'goo.gl' || pathname.startsWith('/maps/'));
  if (url.protocol !== 'https:' || url.port || url.username || url.password || (!direct && !short)) {
    throw new Error('Paste an HTTPS link from Google Maps.');
  }
  return url;
}

function coordinates(url) {
  const path = decodeURIComponent(url.pathname);
  // Google place URLs may contain a viewport and then the more precise pin coordinates.
  const pin = path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  const query = ['query', 'q', 'll', 'destination'].map((field) => url.searchParams.get(field)?.match(pair)).find(Boolean);
  const center = path.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,|\/|$)/);
  const match = pin || query || center;
  return match ? siteCoordinates({ latitude: match[1], longitude: match[2] }) : null;
}

export async function mapsLocation({ mapsUrl: value, latitude, longitude }, fetchLink = fetch) {
  const url = mapsUrl(value);
  const maps_url = url.href;
  if (String(latitude ?? '').trim() || String(longitude ?? '').trim()) {
    return { maps_url, ...siteCoordinates({ latitude, longitude }) };
  }
  if (shortHosts.has(url.hostname)) {
    let redirect = url;
    const signal = AbortSignal.timeout(4500);
    try {
      for (let hop = 0; hop < 4 && shortHosts.has(redirect.hostname); hop += 1) {
        const response = await fetchLink(redirect, { redirect: 'manual', signal });
        await response.body?.cancel();
        const next = response.headers.get('location');
        if (!next || response.status < 300 || response.status >= 400) break;
        redirect = mapsUrl(new URL(next, redirect).href);
      }
      const resolved = coordinates(redirect);
      if (resolved) return { maps_url, ...resolved };
    } catch {
      // A name-only link or an unavailable redirect can use an explicit pin.
    }
  } else {
    const resolved = coordinates(url);
    if (resolved) return { maps_url, ...resolved };
  }
  throw new Error('This link does not expose a GPS pin. In Google Maps, drop a pin and share it, or enter its latitude and longitude below.');
}
