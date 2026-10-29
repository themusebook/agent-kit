import { deriveAssetSignerPda } from "@themusebook/agent-kit-identity";

/**
 * Executive delegation — READ-ONLY helpers.
 *
 * A registered agent may delegate execution of its Asset Signer PDA to an
 * executive wallet. Delegation is explicit, per-asset, inspectable and
 * revocable by the owner — but revocation is an owner-signed onchain action
 * the kit deliberately does NOT perform in v0.1; these helpers only read.
 *
 * Known limit (verified, surfaced honestly): MPL Core Execute delegation
 * has NO on-chain caps or expiry. Treat a delegation as full execution
 * authority over the PDA's float until revoked.
 */

export interface DelegationInfo {
  assetAddress: string;
  assetSigner: string;
  /** Owner of the Core asset (from DAS), when resolvable. */
  owner: string | null;
  /**
   * Executive delegate addresses the indexer reports for the asset, when
   * present in DAS plugin/delegation data. Empty ≠ none exist onchain in
   * every indexer view — treat as best-effort read.
   */
  delegates: string[];
  hasDelegationSurface: boolean;
}

export async function readDelegation(
  rpc: string,
  assetAddress: string,
): Promise<DelegationInfo> {
  const assetSigner = deriveAssetSignerPda(assetAddress).toBase58();
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "agent-kit",
      method: "getAsset",
      params: { id: assetAddress },
    }),
  });
  const json = (await res.json()) as {
    result?: {
      ownership?: { owner?: string; delegate?: string | null };
      plugins?: Record<string, unknown>;
    };
  };
  const asset = json.result;
  const delegates: string[] = [];
  const delegate = asset?.ownership?.delegate;
  if (typeof delegate === "string" && delegate.length > 0) delegates.push(delegate);
  return {
    assetAddress,
    assetSigner,
    owner: asset?.ownership?.owner ?? null,
    delegates,
    hasDelegationSurface: delegates.length > 0,
  };
}
