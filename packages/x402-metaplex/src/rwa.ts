/**
 * Tie-in for the RWA + Raydium agent: the agent's Metaplex Core asset pays
 * x402 from its Asset Signer PDA (coreExecute) — the same keyless treasury
 * that holds the RWA agent's revenue. The owner key only authorises execute.
 */
import type { KeyPairSigner } from "@solana/kit";
import { SpendGuard } from "./guard.js";
import { createCoreAssetPayer, createDelegatedPayer, type DelegateStrategy } from "./payers.js";
import { createX402Tools } from "./tools.js";

export interface RwaAgentX402Options {
  ownerSigner: KeyPairSigner;
  /** The RWA agent's Core asset (paired via the rwa agents' Asset Signer flow). */
  agentAsset: string;
  solanaRpcUrl: string;
  guard: SpendGuard;
  /** "core" = owner signs every payment; "delegated" = Metaplex executes after one approval. */
  via?: "core" | { delegated: DelegateStrategy };
}

export function rwaAgentX402Tools(o: RwaAgentX402Options) {
  const via = o.via ?? "core";
  const f = via === "core"
    ? createCoreAssetPayer(o.ownerSigner, { asset: o.agentAsset, rpcUrl: o.solanaRpcUrl, guard: o.guard })
    : createDelegatedPayer(o.ownerSigner, { asset: o.agentAsset, rpcUrl: o.solanaRpcUrl, guard: o.guard, strategy: via.delegated });
  return createX402Tools({ fetch: f, guard: o.guard, owner: { signer: o.ownerSigner, asset: o.agentAsset, solanaRpcUrl: o.solanaRpcUrl } });
}
