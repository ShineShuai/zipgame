// What the two server adapters (supabase.js, turso.js) share: one error type with a short code,
// and a fetch with a time limit. Codes:
//   rejected      the server refused the data for good (invalid, too many devices): do not retry
//   unauthorized  the group exists and belongs to another auth value
//   busy          too soon, or this device has too many rows until the next prune: try later
//   closed        the server takes no more (its ceiling is reached)
//   denied        the token may not do this (the Turso token lacks `sync:data_add`)
//   network       no answer in time, or not a sensible one
export class CloudError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export async function fetchJson(fetchFn, url, init, timeoutMs) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller && setTimeout(() => controller.abort(), timeoutMs);
  try {
    const options = controller ? { ...init, signal: controller.signal } : init;
    const response = await fetchFn(url, options);
    let body = null;
    try {
      body = await response.json();
    } catch { /* an error page: judged by its status */ }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw new CloudError('network', error && error.message);
  } finally {
    clearTimeout(timer);
  }
}
