/**
 * Directory / registry search.
 *
 * The population layer today is the Musebook DIRECTORY on the hub
 * (musebook.trade); registry.musebook.trade renders it but has NO JSON API
 * of its own (GAPS #1) — so the kit queries hub APIs and treats the
 * registry host as the human surface. When the registry API lands, only
 * the base URL changes.
 *
 * Two machine-readable shapes exist in the wild, and BOTH are supported:
 *
 *  1. The hub directory API: GET {hub}/api/v2/agents?search=&limit=&offset=
 *     answering an array or { agents: [...] }.
 *  2. The published directory snapshot: GET {hub}/live/agents.json —
 *     { generated_at, total_agents, by_network, agents: [...] } where each
 *     record is the DAS-shaped directory entry:
 *       { assetId, name, network, metadataUri, assetSigner, interface,
 *         update_authority, json_uri?, description?, image?,
 *         external_url?, agentToken? }
 *     The agents repo (themusebook/agents, `musebook/agents.json`) carries
 *     the same records in a camelCase envelope
 *     { $schema, apiVersion, generatedAt, source, stats, agents } with
 *     `identifier` + `updateAuthority` instead of `update_authority`.
 *     normalizeAgent() accepts all of these spellings.
 *
 * searchDirectory tries the API first and falls back to the snapshot, so
 * directory reads keep working even when the API route is unavailable.
 */

export interface DiscoveryConfig {
  hub: string;
  registry: string;
}

export interface DirectoryAgent {
  /** Directory/API id when one exists; the asset id for snapshot records. */
  id: string;
  /** MPL Core asset address (snapshot spelling: assetId). */
  assetId: string | null;
  name: string | null;
  description: string | null;
  /** Owner wallet — snapshot spelling is update_authority (the update authority wallet). */
  wallet: string | null;
  ownerWallet: string | null;
  updateAuthority: string | null;
  /** Keyless Asset Signer PDA, when the record carries it. */
  assetSigner: string | null;
  network: string | null;
  image: string | null;
  metadataUri: string | null;
  externalUrl: string | null;
  /** Canonical bound token mint (agent_token binding), when present. */
  agentToken: string | null;
  assetAddress: string | null;
  raw: unknown;
}

const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);

export function normalizeAgent(raw: Record<string, unknown>): DirectoryAgent {
  const assetId =
    str(raw.assetId) ?? str(raw.assetAddress) ?? str(raw.asset) ?? str(raw.mint);
  const owner =
    str(raw.update_authority) ??
    str(raw.updateAuthority) ??
    str(raw.ownerWallet) ??
    str(raw.wallet);
  return {
    id: str(raw.id) ?? str(raw.agentId) ?? str(raw.identifier) ?? assetId ?? "",
    assetId,
    name: str(raw.name),
    description: str(raw.description),
    wallet: owner,
    ownerWallet: owner,
    updateAuthority: owner,
    assetSigner: str(raw.assetSigner) ?? str(raw.asset_signer),
    network: str(raw.network),
    image: str(raw.image),
    metadataUri: str(raw.metadataUri) ?? str(raw.metadata_uri) ?? str(raw.json_uri),
    externalUrl: str(raw.external_url) ?? str(raw.externalUrl),
    agentToken: str(raw.agentToken) ?? str(raw.agent_token),
    assetAddress: assetId,
    raw,
  };
}

/** The snapshot envelope, as published at {hub}/live/agents.json. */
export interface DirectorySnapshot {
  generatedAt: string | null;
  totalAgents: number | null;
  byNetwork: Record<string, number> | null;
  agents: DirectoryAgent[];
}

export function normalizeSnapshot(body: unknown): DirectorySnapshot {
  const env = (body ?? {}) as Record<string, unknown>;
  const list = Array.isArray(body)
    ? (body as Record<string, unknown>[])
    : ((env.agents as Record<string, unknown>[] | undefined) ?? []);
  return {
    generatedAt: str(env.generated_at) ?? str(env.generatedAt),
    totalAgents:
      typeof env.total_agents === "number"
        ? env.total_agents
        : typeof env.totalAgents === "number"
          ? env.totalAgents
          : list.length,
    byNetwork:
      env.by_network && typeof env.by_network === "object"
        ? (env.by_network as Record<string, number>)
        : null,
    agents: list.map(normalizeAgent),
  };
}

/** Fetch + normalize the published directory snapshot. */
export async function fetchDirectorySnapshot(
  config: DiscoveryConfig,
): Promise<DirectorySnapshot> {
  const res = await fetch(`${config.hub.replace(/\/$/, "")}/live/agents.json`);
  if (!res.ok) throw new Error(`Directory snapshot failed: HTTP ${res.status}`);
  return normalizeSnapshot(await res.json());
}

function matchesQuery(agent: DirectoryAgent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [agent.id, agent.name, agent.description, agent.wallet, agent.assetId]
    .filter((v): v is string => typeof v === "string")
    .some((v) => v.toLowerCase().includes(q));
}

/** Search the snapshot client-side (fallback path / offline reads). */
export async function searchDirectorySnapshot(
  config: DiscoveryConfig,
  query: string,
  options: { limit?: number; offset?: number } = {},
): Promise<DirectoryAgent[]> {
  const snapshot = await fetchDirectorySnapshot(config);
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 25;
  return snapshot.agents
    .filter((a) => matchesQuery(a, query))
    .slice(offset, offset + limit);
}

export async function searchDirectory(
  config: DiscoveryConfig,
  query: string,
  options: { limit?: number; offset?: number } = {},
): Promise<DirectoryAgent[]> {
  const params = new URLSearchParams({
    search: query,
    limit: String(options.limit ?? 25),
    offset: String(options.offset ?? 0),
  });
  try {
    const res = await fetch(`${config.hub.replace(/\/$/, "")}/api/v2/agents?${params}`);
    if (!res.ok) throw new Error(`Directory search failed: HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    const list = Array.isArray(body)
      ? body
      : ((body as { agents?: unknown[] }).agents ?? []);
    return (list as Record<string, unknown>[]).map(normalizeAgent);
  } catch {
    // The snapshot is the same population in published form — fall back to
    // it rather than failing the read.
    return searchDirectorySnapshot(config, query, options);
  }
}

export async function getDirectoryAgent(
  config: DiscoveryConfig,
  idOrWallet: string,
): Promise<DirectoryAgent | null> {
  const results = await searchDirectory(config, idOrWallet, { limit: 10 });
  return (
    results.find(
      (a) =>
        a.id === idOrWallet || a.wallet === idOrWallet || a.assetId === idOrWallet,
    ) ??
    results[0] ??
    null
  );
}
