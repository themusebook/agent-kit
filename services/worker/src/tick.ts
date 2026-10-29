import { sweepUrl, type WorkerEnv } from "./env";

/** One sweep. Never throws: a laptop worker with no restart policy must outlive a server blip. */
export async function runOneTick(env: WorkerEnv, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  try {
    const response = await fetchImpl(sweepUrl(env.serverInternalUrl), {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: { authorization: `Bearer ${env.workerSharedSecret}` },
    });
    if (!response.ok) return { ok: false, detail: `server answered ${response.status}` };
    const body = (await response.json()) as { ran?: number };
    return { ok: true, detail: `ran ${body.ran ?? 0}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
