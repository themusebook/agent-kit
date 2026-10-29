import { PublicKey } from "@solana/web3.js";
import { deriveAgentIdentityPda, deriveAssetSignerPda } from "./assetSigner";
import {
  ipfsToHttp,
  validateRegistrationDocument,
  type RegistrationDocument,
} from "./metadata";

/** Minimal config every identity call needs. The client facade fills defaults. */
export interface IdentityConfig {
  /** Solana JSON-RPC endpoint WITH DAS support (getAsset) for resolve. */
  rpc: string;
  network?: "devnet" | "mainnet-beta";
}

/** Loose DAS asset shape — only the fields the kit reads are typed. */
export interface DasAsset {
  id: string;
  interface?: string;
  ownership?: { owner?: string; frozen?: boolean };
  content?: {
    metadata?: { name?: string; description?: string };
    links?: { image?: string };
    json_uri?: string;
  };
  plugins?: Record<string, unknown>;
  grouping?: Array<{ group_key: string; group_value: string }>;
  /**
   * DAS agent fields (snake_case in getAsset/searchAssets responses):
   * `is_agent` is THE distinguisher — `asset_signer` is returned for ALL
   * Core assets (it is a pure PDA derivation), and `agent_token` is absent
   * until a token has been permanently bound with setAgentTokenV1.
   */
  is_agent?: boolean;
  asset_signer?: string;
  agent_token?: string;
  [key: string]: unknown;
}

/**
 * Agent Identity lifecycle hooks (mirrors fetchAsset's
 * agentIdentities[0].lifecycleChecks { transfer, update, execute }):
 * a registered identity attaches Listen hooks for all three. `null` when
 * the indexer did not surface the checks — absence is not a failure.
 */
export interface AgentLifecycleChecks {
  transfer: boolean;
  update: boolean;
  execute: boolean;
}

export interface ResolvedAgent {
  assetAddress: string;
  exists: boolean;
  /** True only when the asset carries a real Agent Identity binding. */
  isAgent: boolean;
  owner: string | null;
  name: string | null;
  /** Registration URI from the Agent Identity record, when present. */
  registrationUri: string | null;
  /** The keyless identity treasury (always derivable, agent or not). */
  assetSigner: string;
  /** Agent Identity PDA (always derivable, agent or not). */
  agentIdentity: string;
  /** Lifecycle hooks from the identity plugin, when the indexer exposes them. */
  lifecycleChecks: AgentLifecycleChecks | null;
  /** Canonical bound token mint, when the asset has an agent_token binding. */
  agentToken: string | null;
  raw: DasAsset | null;
}

async function rpcCall<T>(rpc: string, method: string, params: unknown): Promise<T> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "agent-kit", method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
  return json.result as T;
}

/**
 * Pull the Agent Identity registration URI out of a DAS asset's plugin data.
 * DAS surfaces plugin fields under varying keys across indexers, so this
 * reads defensively — and returns null rather than guessing.
 */
function extractRegistrationUri(asset: DasAsset): string | null {
  const plugins = asset.plugins ?? {};
  for (const key of Object.keys(plugins)) {
    if (!/agent/i.test(key)) continue;
    const plugin = plugins[key] as Record<string, unknown> | undefined;
    const data = (plugin?.data ?? plugin) as Record<string, unknown> | undefined;
    const uri = data?.uri ?? data?.registration_uri ?? data?.registrationUri;
    if (typeof uri === "string" && uri.length > 0) return uri;
  }
  return null;
}

/** Find the Agent Identity plugin's data object in a DAS asset, defensively. */
function agentPluginData(asset: DasAsset): Record<string, unknown> | null {
  const plugins = asset.plugins ?? {};
  for (const key of Object.keys(plugins)) {
    if (!/agent/i.test(key)) continue;
    const plugin = plugins[key] as Record<string, unknown> | undefined;
    const data = (plugin?.data ?? plugin) as Record<string, unknown> | undefined;
    if (data) return data;
  }
  return null;
}

function hookActive(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === "object") {
    const kind = (v as { __kind?: string }).__kind;
    if (kind && kind !== "Listen") return false;
  }
  if (typeof v === "string" && /^(none|reject)$/i.test(v)) return false;
  return true;
}

/**
 * Lifecycle checks from the Agent Identity plugin data
 * (lifecycle_checks / lifecycleChecks { transfer, update, execute }).
 * Returns null when the indexer does not expose them.
 */
function extractLifecycleChecks(asset: DasAsset): AgentLifecycleChecks | null {
  const data = agentPluginData(asset);
  const checks = (data?.lifecycle_checks ?? data?.lifecycleChecks) as
    | Record<string, unknown>
    | undefined;
  if (!checks || typeof checks !== "object") return null;
  return {
    transfer: hookActive(checks.transfer),
    update: hookActive(checks.update),
    execute: hookActive(checks.execute),
  };
}

function extractAgentToken(asset: DasAsset): string | null {
  const plugins = asset.plugins ?? {};
  for (const key of Object.keys(plugins)) {
    const plugin = plugins[key] as Record<string, unknown> | undefined;
    const data = (plugin?.data ?? plugin) as Record<string, unknown> | undefined;
    const token = data?.agent_token ?? data?.agentToken ?? data?.mint;
    if (/token/i.test(key) && typeof token === "string" && token.length > 0) return token;
  }
  return null;
}

/**
 * Resolve a Core asset to its agent record via DAS `getAsset`:
 * Core Asset → AgentIdentity → Registration URI, and Core Asset → Asset
 * Signer PDA. NEVER assume an asset is an agent just because a signer PDA
 * can be derived for it — `isAgent` requires the identity binding.
 */
export async function resolveAgent(
  config: IdentityConfig,
  asset: PublicKey | string,
): Promise<ResolvedAgent> {
  const assetAddress = typeof asset === "string" ? asset : asset.toBase58();
  const assetSigner = deriveAssetSignerPda(assetAddress).toBase58();
  const agentIdentity = deriveAgentIdentityPda(assetAddress).toBase58();
  let raw: DasAsset | null = null;
  try {
    raw = await rpcCall<DasAsset>(config.rpc, "getAsset", { id: assetAddress });
  } catch {
    raw = null; // non-DAS RPC or missing asset: report exists=false below
  }
  if (!raw) {
    return {
      assetAddress, exists: false, isAgent: false, owner: null, name: null,
      registrationUri: null, assetSigner, agentIdentity, lifecycleChecks: null,
      agentToken: null, raw: null,
    };
  }
  const registrationUri = extractRegistrationUri(raw);
  return {
    assetAddress,
    exists: true,
    // DAS is_agent is authoritative when present; the registration URI in
    // the identity plugin is the fallback signal. asset_signer proves
    // nothing — DAS returns it for every Core asset.
    isAgent: raw.is_agent ?? registrationUri !== null,
    owner: raw.ownership?.owner ?? null,
    name: raw.content?.metadata?.name ?? null,
    registrationUri,
    assetSigner,
    agentIdentity,
    lifecycleChecks: extractLifecycleChecks(raw),
    agentToken: raw.agent_token ?? extractAgentToken(raw),
    raw,
  };
}

/**
 * safeFetch semantics for the identity read: resolves the asset and
 * returns its agent record, or **null when the asset is missing or is not
 * a registered agent** — never throws on a missing identity. (An RPC
 * transport failure still surfaces as null here only when getAsset itself
 * reports nothing; use resolveAgent when you need exists/isAgent detail.)
 */
export async function fetchAgentIdentity(
  config: IdentityConfig,
  asset: PublicKey | string,
): Promise<ResolvedAgent | null> {
  const resolved = await resolveAgent(config, asset);
  if (!resolved.exists || !resolved.isAgent) return null;
  return resolved;
}

/**
 * DAS `searchAssets` over Core assets with the agent filters. Request
 * params are camelCase (isAgent, agentToken, assetSigner) even though the
 * response fields come back snake_case (is_agent, agent_token,
 * asset_signer).
 */
export interface SearchAgentAssetsParams {
  /** Default true — search registered agents only. */
  isAgent?: boolean;
  agentToken?: string;
  assetSigner?: string;
  owner?: string;
  limit?: number;
  page?: number;
}

export async function searchAgentAssets(
  config: IdentityConfig,
  params: SearchAgentAssetsParams = {},
): Promise<DasAsset[]> {
  const result = await rpcCall<{ items?: DasAsset[] } | DasAsset[]>(
    config.rpc,
    "searchAssets",
    {
      interface: "MplCoreAsset",
      isAgent: params.isAgent ?? true,
      ...(params.agentToken ? { agentToken: params.agentToken } : {}),
      ...(params.assetSigner ? { assetSigner: params.assetSigner } : {}),
      ...(params.owner ? { owner: params.owner } : {}),
      limit: params.limit ?? 100,
      page: params.page ?? 1,
    },
  );
  if (Array.isArray(result)) return result;
  return result?.items ?? [];
}

/**
 * The directory-record shape shared by the hub snapshot
 * ({hub}/live/agents.json) and the agents repo's musebook/agents.json:
 * the same agent can be spelled `update_authority` (live snapshot) or
 * `updateAuthority` (repo envelope). Only the fields read here are typed.
 */
export interface DirectoryRecordLike {
  assetId?: string;
  assetAddress?: string;
  name?: string;
  assetSigner?: string;
  asset_signer?: string;
  update_authority?: string;
  updateAuthority?: string;
  ownerWallet?: string;
  metadataUri?: string;
  metadata_uri?: string;
  json_uri?: string;
  agentToken?: string;
  agent_token?: string;
  network?: string;
  [key: string]: unknown;
}

/**
 * Resolve an agent from a DIRECTORY RECORD (no RPC needed): the directory
 * snapshot is itself a resolution source — it carries the asset id, the
 * Asset Signer PDA, the owner (update authority) wallet, the registration
 * metadata URI, and the agent_token binding. The signer is still
 * cross-checked against the local PDA derivation, so a record that lies
 * about its signer resolves with isAgent=false and a problem string from
 * verifyDirectoryRecord().
 */
export function resolveFromDirectoryRecord(record: DirectoryRecordLike): ResolvedAgent {
  const assetAddress = record.assetId ?? record.assetAddress ?? "";
  let derived = "";
  try {
    if (assetAddress) derived = deriveAssetSignerPda(assetAddress).toBase58();
  } catch {
    derived = ""; // not a valid pubkey — exists/isAgent stay false below
  }
  const claimedSigner = record.assetSigner ?? record.asset_signer ?? null;
  const registrationUri =
    record.metadataUri ?? record.metadata_uri ?? record.json_uri ?? null;
  return {
    assetAddress,
    exists: assetAddress.length > 0,
    isAgent: registrationUri !== null && claimedSigner !== null && claimedSigner === derived,
    owner: record.update_authority ?? record.updateAuthority ?? record.ownerWallet ?? null,
    name: record.name ?? null,
    registrationUri,
    assetSigner: derived,
    agentIdentity: assetAddress ? safeDeriveIdentity(assetAddress) : "",
    lifecycleChecks: null,
    agentToken: record.agentToken ?? record.agent_token ?? null,
    raw: null,
  };
}

function safeDeriveIdentity(assetAddress: string): string {
  try {
    return deriveAgentIdentityPda(assetAddress).toBase58();
  } catch {
    return "";
  }
}

/** Problems with a directory record's own claims (empty = self-consistent). */
export function verifyDirectoryRecord(record: DirectoryRecordLike): string[] {
  const problems: string[] = [];
  const resolved = resolveFromDirectoryRecord(record);
  if (!resolved.exists) problems.push("record has no assetId");
  const claimedSigner = record.assetSigner ?? record.asset_signer;
  if (!claimedSigner) {
    problems.push("record has no assetSigner");
  } else if (resolved.exists && claimedSigner !== resolved.assetSigner) {
    problems.push("record assetSigner does not match the derived Asset Signer PDA");
  }
  if (!resolved.registrationUri) problems.push("record has no metadata/registration URI");
  if (!resolved.owner) problems.push("record has no update authority / owner wallet");
  return problems;
}

/** Fetch + validate the registration document an agent points at. */
export async function fetchRegistrationDocument(
  uri: string,
): Promise<{ document: RegistrationDocument; problems: string[] }> {
  const res = await fetch(ipfsToHttp(uri));
  if (!res.ok) throw new Error(`Registration document fetch failed: HTTP ${res.status}`);
  const document = (await res.json()) as RegistrationDocument;
  return { document, problems: validateRegistrationDocument(document) };
}

/**
 * Full verification: the asset resolves as an agent, its registration
 * document is valid, and the document names this asset.
 */
export async function verifyAgent(
  config: IdentityConfig,
  asset: PublicKey | string,
): Promise<{ ok: boolean; resolved: ResolvedAgent; problems: string[] }> {
  const resolved = await resolveAgent(config, asset);
  const problems: string[] = [];
  if (!resolved.exists) problems.push("asset not found via DAS");
  if (!resolved.isAgent) problems.push("asset has no Agent Identity registration URI");
  // A registered identity attaches lifecycle hooks for transfer, update
  // and execute (fetchAsset's agentIdentities[0].lifecycleChecks). Empty
  // agentIdentities upstream == not registered; here, when the indexer
  // surfaces the checks, every hook must be active.
  if (resolved.isAgent && resolved.lifecycleChecks) {
    for (const hook of ["transfer", "update", "execute"] as const) {
      if (!resolved.lifecycleChecks[hook]) {
        problems.push(`agent identity lifecycle hook not active: ${hook}`);
      }
    }
  }
  if (resolved.registrationUri) {
    try {
      const { problems: docProblems, document } = await fetchRegistrationDocument(resolved.registrationUri);
      problems.push(...docProblems);
      const named = document.registrations?.some((r) => r.agentId === resolved.assetAddress);
      if (!named) problems.push("registration document does not name this asset in registrations[]");
    } catch (e) {
      problems.push(`registration document unreadable: ${(e as Error).message}`);
    }
  }
  return { ok: problems.length === 0, resolved, problems };
}
