import { PublicKey } from "@solana/web3.js";
import { deriveAssetSignerPda } from "./assetSigner";
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
  [key: string]: unknown;
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
  let raw: DasAsset | null = null;
  try {
    raw = await rpcCall<DasAsset>(config.rpc, "getAsset", { id: assetAddress });
  } catch {
    raw = null; // non-DAS RPC or missing asset: report exists=false below
  }
  if (!raw) {
    return {
      assetAddress, exists: false, isAgent: false, owner: null, name: null,
      registrationUri: null, assetSigner, agentToken: null, raw: null,
    };
  }
  const registrationUri = extractRegistrationUri(raw);
  return {
    assetAddress,
    exists: true,
    isAgent: registrationUri !== null,
    owner: raw.ownership?.owner ?? null,
    name: raw.content?.metadata?.name ?? null,
    registrationUri,
    assetSigner,
    agentToken: extractAgentToken(raw),
    raw,
  };
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
