/**
 * What the worker needs: where the server is, the shared secret, and how often to sweep.
 * Whitespace-only values are refused like unset ones, so a bad deploy fails at boot.
 * The worker has no database of its own; the server owns routine storage.
 */
export type WorkerEnv = { workerSharedSecret: string; serverInternalUrl: string; tickMs: number };

export const DEFAULT_SERVER_INTERNAL_URL = "http://localhost:4000";
export const DEFAULT_TICK_MS = 30_000;

export function loadWorkerEnv(env: Record<string, string | undefined> = process.env): WorkerEnv {
  const workerSharedSecret = env.WORKER_SHARED_SECRET?.trim();
  if (!workerSharedSecret) {
    throw new Error("WORKER_SHARED_SECRET is not set, so this worker cannot call /internal/routines/sweep.");
  }
  const serverInternalUrl = (env.SERVER_INTERNAL_URL?.trim() || DEFAULT_SERVER_INTERNAL_URL).replace(/\/+$/, "");
  if (!serverInternalUrl) throw new Error("SERVER_INTERNAL_URL is not set.");
  let parsed: URL;
  try { parsed = new URL(serverInternalUrl); } catch { throw new Error("SERVER_INTERNAL_URL must be a valid http(s) URL."); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("SERVER_INTERNAL_URL must be a valid http(s) URL.");
  const rawTick = env.WORKER_TICK_MS?.trim();
  const tickMs = rawTick ? Number(rawTick) : DEFAULT_TICK_MS;
  if (!Number.isInteger(tickMs) || tickMs < 1000) throw new Error("WORKER_TICK_MS must be a whole number of at least 1000.");
  return { workerSharedSecret, serverInternalUrl, tickMs };
}

export function sweepUrl(serverInternalUrl: string): string {
  return `${serverInternalUrl}/internal/routines/sweep`;
}
