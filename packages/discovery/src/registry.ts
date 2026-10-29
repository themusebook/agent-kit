/**
 * Directory / registry search.
 *
 * The population layer today is the Musebook DIRECTORY on the hub
 * (musebook.trade); registry.musebook.trade renders it but has NO JSON API
 * of its own (GAPS #1) — so the kit queries hub APIs and treats the
 * registry host as the human surface. When the registry API lands, only
 * the base URL changes.
 * ASSUMPTION: the directory list endpoint is GET {hub}/api/v2/agents with
 * ?search=&limit=&offset= and answers an array or { agents: [...] }.
 */

export interface DiscoveryConfig {
  hub: string;
  registry: string;
}

export interface DirectoryAgent {
  id: string;
  name: string | null;
  description: string | null;
  wallet: string | null;
  assetAddress: string | null;
  raw: unknown;
}

function normalizeAgent(raw: Record<string, unknown>): DirectoryAgent {
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    id: str(raw.id) ?? str(raw.agentId) ?? "",
    name: str(raw.name),
    description: str(raw.description),
    wallet: str(raw.wallet) ?? str(raw.ownerWallet),
    assetAddress: str(raw.assetAddress) ?? str(raw.asset) ?? str(raw.mint),
    raw,
  };
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
  const res = await fetch(`${config.hub.replace(/\/$/, "")}/api/v2/agents?${params}`);
  if (!res.ok) throw new Error(`Directory search failed: HTTP ${res.status}`);
  const body = (await res.json()) as unknown;
  const list = Array.isArray(body)
    ? body
    : ((body as { agents?: unknown[] }).agents ?? []);
  return (list as Record<string, unknown>[]).map(normalizeAgent);
}

export async function getDirectoryAgent(
  config: DiscoveryConfig,
  idOrWallet: string,
): Promise<DirectoryAgent | null> {
  const results = await searchDirectory(config, idOrWallet, { limit: 10 });
  return (
    results.find((a) => a.id === idOrWallet || a.wallet === idOrWallet) ??
    results[0] ??
    null
  );
}
