import { normalizeSnapshot, parseContentProfile, type DirectorySnapshot } from "@themusebook/agent-kit-discovery";

/** Everything the dashboard reads goes through services/server via the /server proxy. */
export const SERVER_BASE = "/server";

export type Health = { status: string; musebook: string; database: "memory" | "postgres"; openbot: string };
export type Routine = {
  id: string; agentId: string; kind: string; intervalSeconds: number; nextRunAt: number; lastStatus?: string;
};
export type X402mSummary = {
  endpoint: string | null;
  capabilities: string[];
  contentProfiles: { id: string; name: string; major: number | null }[];
  raw: unknown;
};

async function getJson<T>(fetchImpl: typeof fetch, path: string): Promise<T> {
  const response = await fetchImpl(`${SERVER_BASE}${path}`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

export function summarizeX402m(body: unknown): X402mSummary {
  const doc = (body ?? {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const endpoint = typeof doc.endpoint === "string" ? doc.endpoint
    : typeof doc.execute_endpoint === "string" ? doc.execute_endpoint : null;
  return {
    endpoint,
    capabilities: strings(doc.capabilities),
    contentProfiles: strings(doc.contentProfiles).map((id) => {
      const parsed = parseContentProfile(id);
      return { id, name: parsed?.name ?? id, major: parsed?.major ?? null };
    }),
    raw: body,
  };
}

/** Inbox status = the latest result of each agent's x402m inbox-poll job. */
export function inboxStatus(routines: Routine[]) {
  return routines
    .filter((r) => r.kind === "x402m.inbox-poll")
    .map((r) => ({ agentId: r.agentId, lastStatus: r.lastStatus ?? "not run yet", nextRunAt: r.nextRunAt }));
}

export function createApi(fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  return {
    health: () => getJson<Health>(fetchImpl, "/health"),
    directory: async (): Promise<DirectorySnapshot> => normalizeSnapshot(await getJson(fetchImpl, "/api/agents")),
    x402m: async () => summarizeX402m(await getJson(fetchImpl, "/api/x402m/discovery")),
    routines: async () => (await getJson<{ routines: Routine[] }>(fetchImpl, "/internal/routines")).routines,
  };
}
export type Api = ReturnType<typeof createApi>;

export function filterAgents(snapshot: DirectorySnapshot, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return snapshot.agents;
  return snapshot.agents.filter((a) =>
    [a.name, a.description, a.assetId, a.wallet, a.id].some((v) => typeof v === "string" && v.toLowerCase().includes(q)),
  );
}
