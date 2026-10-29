import { normalizeSnapshot, parseContentProfile, type DirectorySnapshot } from "@musebook/discovery";

// Same reads as apps/app/src/api.ts, against an absolute dashboard origin.
export type Health = { status: string; musebook: string; database: "memory" | "postgres"; openbot: string };
export type Routine = { id: string; agentId: string; kind: string; intervalSeconds: number; nextRunAt: number; lastStatus?: string };
export type X402mSummary = { endpoint: string | null; capabilities: string[]; contentProfiles: { id: string; name: string; major: number | null }[] };

export function summarizeX402m(body: unknown): X402mSummary {
  const doc = (body ?? {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const endpoint = typeof doc.endpoint === "string" ? doc.endpoint : typeof doc.execute_endpoint === "string" ? doc.execute_endpoint : null;
  return {
    endpoint,
    capabilities: strings(doc.capabilities),
    contentProfiles: strings(doc.contentProfiles).map((id) => {
      const p = parseContentProfile(id);
      return { id, name: p?.name ?? id, major: p?.major ?? null };
    }),
  };
}

export const inboxStatus = (routines: Routine[]) =>
  routines.filter((r) => r.kind === "x402m.inbox-poll").map((r) => ({ agentId: r.agentId, lastStatus: r.lastStatus ?? "not run yet" }));

export function filterAgents(snapshot: DirectorySnapshot, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return snapshot.agents;
  return snapshot.agents.filter((a) => [a.name, a.description, a.assetId, a.wallet, a.id].some((v) => typeof v === "string" && v.toLowerCase().includes(q)));
}

export function createApi(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const get = async <T,>(path: string): Promise<T> => {
    const r = await fetchImpl(`${base}${path}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return (await r.json()) as T;
  };
  return {
    health: () => get<Health>("/health"),
    directory: async (): Promise<DirectorySnapshot> => normalizeSnapshot(await get("/api/agents")),
    x402m: async () => summarizeX402m(await get("/api/x402m/discovery")),
    routines: async () => (await get<{ routines: Routine[] }>("/internal/routines")).routines,
  };
}
export type Api = ReturnType<typeof createApi>;
