import type { TransactionSigner } from "@themusebook/agent-kit-wallet";
import { PublicKey } from "@solana/web3.js";
import {
  deriveAgentIdentityPda,
  deriveAssetSignerPda,
  MPL_AGENT_REGISTRY_PROGRAM_ID,
} from "./assetSigner";
import {
  AgentApiError,
  AgentApiNetworkError,
  AgentValidationError,
  type FieldProblem,
} from "./errors";
import {
  buildAgentMetadata,
  toMetaplexNetwork,
  validateAgentMetadata,
  type AgentMetadata,
  type AgentMetadataInput,
  type MetaplexNetwork,
  type RegistrationDocument,
} from "./metadata";

/**
 * Registration = two steps, one contract (ARCHITECTURE §5). The directory
 * step lives in @themusebook/agent-kit-auth (`registerDirectory`); this
 * module is step 2: the identity mint.
 *
 * The mint goes through the Metaplex HOSTED API
 * (POST https://api.metaplex.com/v1/agents/mint), mirroring the upstream
 * mpl-agent-registry SDK flow:
 *
 *   buildAgentMint()  ≈ mintAgent            — API call only; returns the
 *                                              unsigned transaction + the
 *                                              pre-computed asset address.
 *   registerIdentity() ≈ mintAndSubmitAgent — buildAgentMint + caller signs
 *                                              + broadcast + finalize poll.
 *
 * Two DISTINCT metadata fields ride the mint call (do not conflate them):
 *   uri           — onchain Core asset NFT metadata JSON URL; must be
 *                   publicly accessible.
 *   agentMetadata — off-chain record stored by the Metaplex API
 *                   ({ type: 'agent', name, description, services,
 *                   registrations, supportedTrust }).
 *
 * ⚠️ NO DEDUPLICATION: every successful mint creates a NEW Core asset at a
 * NEW address. Calling registerIdentity twice with the same input creates
 * two separate agents.
 *
 * ⚠️ BLOCKHASH EXPIRY: if submission fails because the blockhash expired,
 * the fix is to call buildAgentMint/registerIdentity again — the API
 * issues a fresh transaction (and a new asset address) per call.
 *
 * The kit NEVER holds keys: signing is the caller-supplied signer, and an
 * optional caller `txSender` hook may replace the kit's own broadcast
 * (Jito bundles, custom retry/confirmation infrastructure, …).
 */

export interface IdentityConfigLike {
  rpc: string;
  network?: "devnet" | "mainnet-beta";
  /**
   * Metaplex hosted API base URL (the SDK's `baseUrl` config).
   * Default https://api.metaplex.com — no API key required.
   */
  metaplexApi?: string;
  /** Full hosted-API network value; wins over the coarse `network` switch. */
  metaplexNetwork?: MetaplexNetwork;
}

export interface RegisterIdentityInput {
  signer: TransactionSigner;
  /** Agent display name (also used for agentMetadata.name). */
  name?: string;
  /**
   * The Core asset's NFT metadata JSON URL — stored ONCHAIN. Must be
   * publicly accessible.
   */
  uri?: string;
  /** @deprecated Alias of `uri` kept from v0.1 — prefer `uri`. */
  metadataUri?: string;
  /**
   * The OFF-CHAIN agent record for the hosted API. When omitted it is
   * built from `name` + `document`, but a description is required either
   * way (the API rejects records without one).
   */
  agentMetadata?: AgentMetadataInput;
  /**
   * Optional: registration-document fields for callers who pinned the
   * EIP-8004 document themselves and want the API record kept in sync.
   */
  document?: Pick<RegistrationDocument, "description" | "services" | "supportedTrust">;
  /** Hosted-API network override (defaults from the kit network switch). */
  network?: MetaplexNetwork;
  /**
   * Custom transaction sender (mirrors mintAndSubmitAgent's txSender):
   * receives the SIGNED base64 transaction, returns the signature.
   * Replaces the kit's RPC broadcast + finalize poll.
   */
  txSender?: (signedTransactionBase64: string) => Promise<string>;
}

export interface RegisterIdentityResult {
  signature: string;
  /** Asset address as returned by the hosted API, when it provides one. */
  assetAddress: string | null;
  assetSigner: string | null;
  /** Agent Identity PDA for the new asset, when its address is known. */
  agentIdentity: string | null;
  /** The `uri` the asset was minted with. */
  metadataUri: string;
}

interface HostedMintResponse {
  transaction?: string; // base64 unsigned tx
  tx?: string;
  asset?: string;
  assetAddress?: string;
  assetSigner?: string;
  [key: string]: unknown;
}

/** The two mint fields, resolved + typed. Internal to the mint flow. */
interface ResolvedMintFields {
  name: string;
  uri: string;
  agentMetadata: AgentMetadata;
  network: MetaplexNetwork;
}

function resolveMintFields(
  config: IdentityConfigLike,
  input: RegisterIdentityInput,
): ResolvedMintFields {
  const uri = input.uri ?? input.metadataUri ?? "";
  const agentMetadata = buildAgentMetadata({
    name: input.agentMetadata?.name ?? input.name ?? "",
    description:
      input.agentMetadata?.description ?? input.document?.description ?? "",
    services: input.agentMetadata?.services ?? input.document?.services ?? [],
    registrations: input.agentMetadata?.registrations ?? [],
    supportedTrust:
      input.agentMetadata?.supportedTrust ?? input.document?.supportedTrust ?? [],
  });
  return {
    name: agentMetadata.name,
    uri,
    agentMetadata,
    network: input.network ?? config.metaplexNetwork ?? toMetaplexNetwork(config.network),
  };
}

/**
 * Client-side validation of the mint input, mirroring the upstream SDK:
 * problems are reported per-field and NO API call is made when this list
 * is non-empty (buildAgentMint throws AgentValidationError instead).
 */
export function validateRegisterIdentityInput(
  config: IdentityConfigLike,
  input: RegisterIdentityInput,
): FieldProblem[] {
  const fields = resolveMintFields(config, input);
  const problems: FieldProblem[] = [];
  if (!fields.uri) {
    problems.push({
      field: "uri",
      message: "uri is required — a publicly accessible JSON URL for the Core asset metadata",
    });
  } else if (!/^https?:\/\//.test(fields.uri) && !fields.uri.startsWith("ipfs://") && !fields.uri.startsWith("ar://")) {
    problems.push({ field: "uri", message: "uri must be a publicly accessible URL" });
  }
  for (const p of validateAgentMetadata(fields.agentMetadata)) {
    // validateAgentMetadata messages are prefixed with the field path.
    const m = /^agentMetadata\.(\w+)/.exec(p);
    problems.push({ field: m ? `agentMetadata.${m[1]}` : "agentMetadata", message: p });
  }
  return problems;
}

async function rpc(config: IdentityConfigLike, method: string, params: unknown): Promise<unknown> {
  const res = await fetch(config.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "agent-kit", method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) {
    const msg = json.error.message ?? `RPC ${method} failed`;
    if (/blockhash/i.test(msg)) {
      throw new Error(
        `${msg} — blockhash expired: re-call buildAgentMint/registerIdentity so the hosted API issues a fresh transaction, then sign and submit again.`,
      );
    }
    throw new Error(`RPC ${method} failed: ${msg}`);
  }
  return json.result;
}

/** Poll getSignatureStatuses until finalized (or timeout). */
export async function pollFinalized(
  config: IdentityConfigLike,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = (await rpc(config, "getSignatureStatuses", [
      [signature],
      { searchTransactionHistory: true },
    ])) as { value?: Array<{ confirmationStatus?: string; err?: unknown } | null> };
    const status = result?.value?.[0];
    if (status?.err) throw new Error(`Transaction failed onchain: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "finalized") return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`Timed out waiting for finalization of ${signature}`);
}

export interface BuiltAgentMint {
  /** Base64 unsigned transaction built by the hosted API. */
  transaction: string;
  /** Pre-computed address of the Core asset the transaction will create. */
  assetAddress: string | null;
  network: MetaplexNetwork;
}

/**
 * The hosted-API step alone (≈ upstream `mintAgent`): validates the input
 * client-side, POSTs /v1/agents/mint, and returns the unsigned transaction
 * plus the pre-computed asset address. Nothing is signed or broadcast —
 * use this when you need manual signing control, priority fees, or your
 * own submission pipeline; use registerIdentity for the one-call flow.
 */
export async function buildAgentMint(
  config: IdentityConfigLike,
  input: RegisterIdentityInput,
): Promise<BuiltAgentMint> {
  const problems = validateRegisterIdentityInput(config, input);
  if (problems.length > 0) {
    const first = problems[0]!;
    throw new AgentValidationError(first.field, first.message);
  }
  const fields = resolveMintFields(config, input);
  const api = (config.metaplexApi ?? "https://api.metaplex.com").replace(/\/$/, "");

  let res: Response;
  try {
    res = await fetch(`${api}/v1/agents/mint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        wallet: input.signer.publicKey,
        network: fields.network,
        name: fields.name,
        uri: fields.uri,
        agentMetadata: fields.agentMetadata,
      }),
    });
  } catch (e) {
    throw new AgentApiNetworkError(
      `Could not reach the Metaplex API at ${api}`,
      e,
    );
  }
  const bodyText = await res.text();
  if (!res.ok) {
    throw new AgentApiError(
      res.status,
      `Hosted mint API failed: HTTP ${res.status}`,
      bodyText,
    );
  }
  let mint: HostedMintResponse;
  try {
    mint = JSON.parse(bodyText) as HostedMintResponse;
  } catch {
    throw new AgentApiError(res.status, "Hosted mint API returned a non-JSON body", bodyText);
  }
  const transaction = mint.transaction ?? mint.tx;
  if (!transaction) {
    throw new AgentApiError(res.status, "Hosted mint API returned no transaction", mint);
  }
  return {
    transaction,
    assetAddress: mint.assetAddress ?? mint.asset ?? null,
    network: fields.network,
  };
}

/**
 * One-call mint (≈ upstream `mintAndSubmitAgent`): build → caller signs →
 * broadcast → finalize. Remember: NO deduplication — each call mints a
 * brand-new agent asset.
 */
export async function registerIdentity(
  config: IdentityConfigLike,
  input: RegisterIdentityInput,
): Promise<RegisterIdentityResult> {
  const built = await buildAgentMint(config, input);
  const fields = resolveMintFields(config, input);

  const signedTx = await input.signer.signTransaction(built.transaction);
  let signature: string;
  if (input.txSender) {
    signature = await input.txSender(signedTx);
  } else {
    signature = (await rpc(config, "sendTransaction", [
      signedTx,
      { encoding: "base64" },
    ])) as string;
    await pollFinalized(config, signature);
  }

  const assetAddress = built.assetAddress;
  return {
    signature,
    assetAddress,
    assetSigner: assetAddress ? deriveAssetSignerPda(assetAddress).toBase58() : null,
    agentIdentity: assetAddress ? deriveAgentIdentityPda(assetAddress).toBase58() : null,
    metadataUri: fields.uri,
  };
}

// ---------------------------------------------------------------------------
// registerIdentityV1 — attach an identity to an EXISTING Core asset.
//
// This is a different flow from the hosted mint above: no new asset is
// created; the Agent Identity plugin is registered onto an asset the
// caller already owns (upstream: mpl-agent-registry `registerIdentityV1`,
// the same builder the owner's RWA stack wraps as `buildRegisterIdentity`).
// The kit emits a typed instruction descriptor; execution goes through the
// caller's own SDK/adapter (the kit ships no Umi runtime), signed by the
// asset authority — possibly via Core Execute from the Asset Signer PDA
// when an executive operates the agent.
// ---------------------------------------------------------------------------

export interface RegisterIdentityV1Input {
  /** The EXISTING MPL Core asset to attach the identity to. */
  asset: string;
  /** Optional collection the asset belongs to. */
  collection?: string;
  /** The EIP-8004 registration document URI (permanent — ipfs/ar/Irys). */
  agentRegistrationUri: string;
  /** Fee payer. Defaults (at execution time) to the authority. */
  payer?: string;
  /** Update authority of the asset; the signer of the registration. */
  authority?: string;
}

export interface RegisterIdentityV1Descriptor {
  kind: "registerIdentityV1";
  /** Agent Registry program that owns the instruction. */
  program: string;
  asset: string;
  collection: string | null;
  agentIdentityPda: string;
  assetSigner: string;
  agentRegistrationUri: string;
  payer: string | null;
  authority: string | null;
  /**
   * registerIdentityV1 is ONE-TIME per asset: re-registering an asset
   * that already has an Agent Identity fails. There is no update-in-place
   * through this instruction.
   */
  oneTimePerAsset: true;
}

export function buildRegisterIdentityV1(
  input: RegisterIdentityV1Input,
): RegisterIdentityV1Descriptor {
  try {
    new PublicKey(input.asset);
  } catch {
    throw new AgentValidationError("asset", "asset must be a valid Solana public key");
  }
  if (input.collection) {
    try {
      new PublicKey(input.collection);
    } catch {
      throw new AgentValidationError("collection", "collection must be a valid Solana public key");
    }
  }
  if (!input.agentRegistrationUri) {
    throw new AgentValidationError(
      "agentRegistrationUri",
      "agentRegistrationUri is required — the EIP-8004 registration document URI",
    );
  }
  return {
    kind: "registerIdentityV1",
    program: MPL_AGENT_REGISTRY_PROGRAM_ID.toBase58(),
    asset: input.asset,
    collection: input.collection ?? null,
    agentIdentityPda: deriveAgentIdentityPda(input.asset).toBase58(),
    assetSigner: deriveAssetSignerPda(input.asset).toBase58(),
    agentRegistrationUri: input.agentRegistrationUri,
    payer: input.payer ?? input.authority ?? null,
    authority: input.authority ?? null,
    oneTimePerAsset: true,
  };
}
