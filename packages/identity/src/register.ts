import type { TransactionSigner } from "@themusebook/agent-kit-wallet";
import { deriveAssetSignerPda } from "./assetSigner";
import type { RegistrationDocument } from "./metadata";

/**
 * Registration = two steps, one contract (ARCHITECTURE §5). The directory
 * step lives in @themusebook/agent-kit-auth (`registerDirectory`); this
 * module is step 2: the identity mint.
 *
 * The mint goes through the Metaplex HOSTED API
 * (POST https://api.metaplex.com/v1/agents/mint): the API builds the
 * unsigned transaction that creates the MPL Core asset + Agent Identity
 * PDA atomically; the caller's wallet signs it; the kit broadcasts and
 * polls for finalization (websocket confirmation is unreliable in some
 * runtimes — poll `getSignatureStatuses`, per the registration skill).
 *
 * The kit NEVER holds keys: signing is the caller-supplied signer callback.
 */

export interface IdentityConfigLike {
  rpc: string;
  network?: "devnet" | "mainnet-beta";
  /** Metaplex hosted API base. Default https://api.metaplex.com */
  metaplexApi?: string;
}

export interface RegisterIdentityInput {
  signer: TransactionSigner;
  name: string;
  /** Permanent ipfs:// URI of the registration document (pin it first). */
  metadataUri: string;
  /**
   * Optional: the document itself, for callers who pinned via a callback
   * and want the mint's agentMetadata fields kept in sync.
   */
  document?: Pick<RegistrationDocument, "description" | "services" | "supportedTrust">;
}

export interface RegisterIdentityResult {
  signature: string;
  /** Asset address as returned by the hosted API, when it provides one. */
  assetAddress: string | null;
  assetSigner: string | null;
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

async function rpc(config: IdentityConfigLike, method: string, params: unknown): Promise<unknown> {
  const res = await fetch(config.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "agent-kit", method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`RPC ${method} failed: ${json.error.message}`);
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

export async function registerIdentity(
  config: IdentityConfigLike,
  input: RegisterIdentityInput,
): Promise<RegisterIdentityResult> {
  const api = (config.metaplexApi ?? "https://api.metaplex.com").replace(/\/$/, "");
  const network = config.network === "devnet" ? "solana-devnet" : "solana";

  // ASSUMPTION (documented in ARCHITECTURE §1/§5): the hosted mint endpoint
  // accepts { wallet, network, name, uri, agentMetadata } and returns a
  // base64 unsigned transaction plus the new asset address. Field names are
  // read defensively below.
  const res = await fetch(`${api}/v1/agents/mint`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: input.signer.publicKey,
      network,
      name: input.name,
      uri: input.metadataUri,
      agentMetadata: {
        type: "agent",
        name: input.name,
        description: input.document?.description ?? "",
        services: input.document?.services ?? [],
        registrations: [],
        supportedTrust: input.document?.supportedTrust ?? [],
      },
    }),
  });
  if (!res.ok) throw new Error(`Hosted mint API failed: HTTP ${res.status}`);
  const mint = (await res.json()) as HostedMintResponse;
  const unsignedTx = mint.transaction ?? mint.tx;
  if (!unsignedTx) throw new Error("Hosted mint API returned no transaction");

  const signedTx = await input.signer.signTransaction(unsignedTx);
  const signature = (await rpc(config, "sendTransaction", [
    signedTx,
    { encoding: "base64" },
  ])) as string;
  await pollFinalized(config, signature);

  const assetAddress = mint.assetAddress ?? mint.asset ?? null;
  return {
    signature,
    assetAddress,
    assetSigner: assetAddress ? deriveAssetSignerPda(assetAddress).toBase58() : null,
    metadataUri: input.metadataUri,
  };
}
