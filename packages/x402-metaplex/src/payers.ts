/**
 * The three Metaplex x402 payment modes, each returning a guarded fetch.
 *
 *  1. standard   — a plain wallet pays with ExactSvmScheme (USDC only, no SOL needed).
 *  2. coreAsset  — a Core asset / agent pays from its Asset Signer PDA via
 *                  MetaplexSvmExactScheme + coreExecute (PDA needs USDC + SOL).
 *  3. delegated  — the asset owner approves the Metaplex execute delegate ONCE,
 *                  then EITHER the reactive client extension OR the proactive
 *                  fetch wrapper is used — never both. 24h SIWX JWT, in-memory store.
 *
 * Keys only come from env (SVM_PRIVATE_KEY, base58 64-byte). They are never
 * logged, returned, or attached to errors.
 */
import {
  METAPLEX_API_BASE_URL,
  MetaplexSvmExactScheme,
  createMetaplexCoreExecuteDelegateClientExtension,
  wrapFetchWithMetaplexCoreExecuteDelegate,
  InMemoryMetaplexCoreExecuteDelegateAuthTokenStore,
  fetchMetaplexCoreExecuteDelegateStatus,
  approveMetaplexCoreExecuteDelegate,
  revokeMetaplexCoreExecuteDelegate,
} from "@metaplex-foundation/x402";
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";
import { x402Client } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { SpendGuard, SpendGuardError } from "./guard.js";

export type Env = Record<string, string | undefined>;

export interface PayerBase {
  guard: SpendGuard;
  rpcUrl?: string;
  baseFetch?: typeof fetch;
}

/** Load the signer from env. Throws a key-free error if missing/malformed. */
export async function signerFromEnv(env: Env = process.env, name = "SVM_PRIVATE_KEY"): Promise<KeyPairSigner> {
  const v = env[name];
  if (!v) throw new Error(`${name} is not set (base58 64-byte keypair; env only).`);
  try {
    return await createKeyPairSignerFromBytes(getBase58Encoder().encode(v));
  } catch {
    throw new Error(`${name} is not a valid base58 64-byte keypair.`); // never echo the value
  }
}

function inner(o: PayerBase): typeof fetch {
  return o.guard.wrapInnerFetch(o.baseFetch ?? globalThis.fetch);
}

/** Mode 1: standard wallet. */
export function createStandardPayer(signer: KeyPairSigner, o: PayerBase): typeof fetch {
  const client = new x402Client();
  client.register("solana:*", new ExactSvmScheme(signer as any, o.rpcUrl ? { rpcUrl: o.rpcUrl } : undefined));
  return wrapFetchWithPayment(inner(o), client) as typeof fetch;
}

/** Mode 2: Core asset / agent direct — the asset signer PDA pays. */
export function createCoreAssetPayer(
  signer: KeyPairSigner,
  o: PayerBase & { asset: string; collection?: string; rpcUrl: string },
): typeof fetch {
  const client = new x402Client();
  client.register(
    "solana:*",
    new MetaplexSvmExactScheme(signer as any, {
      rpcUrl: o.rpcUrl,
      coreExecute: { asset: o.asset, ...(o.collection ? { collection: o.collection } : {}) },
    } as any),
  );
  return wrapFetchWithPayment(inner(o), client) as typeof fetch;
}

export type DelegateStrategy = "reactive" | "proactive";

/**
 * Mode 3: delegated. Requires the delegate to be approved already (see
 * delegateApprove). Picks exactly one strategy.
 */
export function createDelegatedPayer(
  signer: KeyPairSigner,
  o: PayerBase & { asset: string; rpcUrl: string; strategy: DelegateStrategy; baseUrl?: string },
): typeof fetch {
  const authTokenStore = new InMemoryMetaplexCoreExecuteDelegateAuthTokenStore();
  const baseUrl = o.baseUrl ?? METAPLEX_API_BASE_URL;
  if (o.strategy === "proactive") {
    // Proactive: no x402 client/extension at all. The guard still sees any 402.
    return wrapFetchWithMetaplexCoreExecuteDelegate(inner(o), {
      signer: signer as any, asset: o.asset, authTokenStore, baseUrl,
    } as any) as typeof fetch;
  }
  if (o.strategy !== "reactive") throw new Error('strategy must be "reactive" or "proactive"');
  const client = new x402Client();
  client.register("solana:*", new MetaplexSvmExactScheme(signer as any, { rpcUrl: o.rpcUrl } as any));
  client.registerExtension(
    createMetaplexCoreExecuteDelegateClientExtension({ signer: signer as any, asset: o.asset, authTokenStore, baseUrl } as any),
  );
  return wrapFetchWithPayment(inner(o), client) as typeof fetch;
}

/** Free: is the Metaplex execute delegate approved for this asset? */
export async function delegateStatus(asset: string, baseUrl = METAPLEX_API_BASE_URL): Promise<{ isDelegated: boolean; executionDelegateRecord?: unknown }> {
  return fetchMetaplexCoreExecuteDelegateStatus(asset, { baseUrl });
}

/** On-chain tx (owner signs). Refused unless the guard is in pay mode AND confirm=true. */
export async function delegateApprove(
  signer: KeyPairSigner,
  o: { asset: string; rpcUrl: string; guard: SpendGuard; confirm: boolean; baseUrl?: string },
) {
  if (o.guard.mode !== "pay" || !o.confirm) {
    throw new SpendGuardError("delegate approve sends an on-chain transaction; needs mode pay + confirm", "discovery_only");
  }
  const st = await delegateStatus(o.asset, o.baseUrl);
  if (st.isDelegated) return { alreadyDelegated: true as const };
  const r = await approveMetaplexCoreExecuteDelegate(signer as any, o.asset, { baseUrl: o.baseUrl ?? METAPLEX_API_BASE_URL, rpcUrl: o.rpcUrl });
  return { alreadyDelegated: false as const, signature: r.signature };
}

/** Revoke helper. Revoking never spends USDC, but it is a tx, so it also needs confirm. */
export async function delegateRevoke(
  signer: KeyPairSigner,
  o: { asset: string; rpcUrl: string; confirm: boolean; baseUrl?: string },
) {
  if (!o.confirm) throw new Error("delegate revoke sends an on-chain transaction; pass confirm: true");
  const r = await revokeMetaplexCoreExecuteDelegate(signer as any, o.asset, { baseUrl: o.baseUrl ?? METAPLEX_API_BASE_URL, rpcUrl: o.rpcUrl });
  return { signature: r.signature };
}
