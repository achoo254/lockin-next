/**
 * Google Maps links people paste as a place. Only https links on Google's own map hosts are kept as a place's map
 * link; anything else stays plain text. Nothing here fetches or follows a link (no outbound call from the server).
 * Shared with the web app, which checks the same way before sending.
 */

export const MAX_MAP_URL = 2048;

/** Host → the path prefixes accepted on it. */
const ACCEPTED: Record<string, readonly string[]> = {
  'maps.app.goo.gl': ['/'],
  'goo.gl': ['/maps/'],
  'google.com': ['/maps/place/', '/maps/search/'],
  'www.google.com': ['/maps/place/', '/maps/search/'],
};

function parse(value: string): URL | null {
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** A pasted Google Maps link: https, one of the accepted hosts and paths, no credentials, not too long. */
export function isGoogleMapsLink(value: string): boolean {
  if (value.length > MAX_MAP_URL) return false;
  const url = parse(value);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  const prefixes = ACCEPTED[url.hostname];
  // Something after the prefix: a link id, a place or a search.
  return prefixes !== undefined && prefixes.some((prefix) => url.pathname.startsWith(prefix) && url.pathname.length > prefix.length);
}

/** The place name of a google.com/maps/place/<Name>/… link ("Cộng Cà Phê"), else null (short links tell nothing). */
export function placeNameFromMapsLink(value: string): string | null {
  if (!isGoogleMapsLink(value)) return null;
  const url = parse(value);
  const match = url ? /^\/maps\/place\/([^/]+)/.exec(url.pathname) : null;
  if (!match?.[1]) return null;
  try {
    const name = decodeURIComponent(match[1].replace(/\+/g, ' ')).trim();
    // A coordinates-only segment ("@10.77,106.69") is no name.
    return name && !name.startsWith('@') ? name.slice(0, 300) : null;
  } catch {
    return null;
  }
}

/** Where "Mở bản đồ" goes: the place's own map link, else a Google Maps search for the place and area (no key). */
export function mapsSearchUrl(label: string, area: string | null): string {
  const query = area ? `${label}, ${area}` : label;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
