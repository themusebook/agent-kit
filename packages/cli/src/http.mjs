// Pattern from Solizardking/agents cli/src/client.mjs: JSON fetch with timeout and typed errors.
export const ORIGIN = 'https://musebook.trade';
export class HttpError extends Error {
  constructor(message, { status, body } = {}) { super(message); this.status = status; this.body = body; }
}
export async function request(method, url, { body, headers, fetchImpl = fetch, timeoutMs = 25_000 } = {}) {
  const res = await fetchImpl(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { status: res.status, ok: res.ok, data, headers: res.headers };
}
export async function json(method, url, opts) {
  const r = await request(method, url, opts);
  if (!r.ok) throw new HttpError(`${method} ${new URL(url).pathname}: HTTP ${r.status}${r.data?.error ? ` (${String(r.data.error).slice(0, 120)})` : ''}`, r);
  return r.data;
}
