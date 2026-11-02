/** JSON calls to the app's own API (same origin; the session cookie goes along). */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

async function errorCode(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') return body.error;
  } catch {
    // Not JSON (a proxy error page): fall through.
  }
  return `http-${res.status}`;
}

/** The code of a request that never got an answer (offline, DNS, connection reset). */
export const NETWORK_ERROR = 'network';
/** The code of an answer that is not what the API documents. */
export const BAD_RESPONSE = 'bad-response';

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('Content-Type', 'application/json');
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }
  if (!res.ok) throw new ApiError(res.status, await errorCode(res));
  return res;
}
