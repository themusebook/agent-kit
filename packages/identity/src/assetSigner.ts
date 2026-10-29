import { PublicKey } from "@solana/web3.js";

/** MPL Core program — owner of the Asset Signer ("Execute") PDA. */
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d",
);

/** Metaplex Agent Registry program (binds Agent Identity records to assets). */
export const MPL_AGENT_REGISTRY_PROGRAM_ID = new PublicKey(
  "1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p",
);

export const ASSET_SIGNER_SEED = "mpl-core-execute";

/**
 * Derive the Asset Signer PDA for an MPL Core agent asset:
 *
 *   PDA("mpl-core-execute", agent_core_asset) under the MPL Core program.
 *
 * This PDA is the agent's identity-linked treasury wallet. It has NO
 * private key — it is operated through MPL Core Execute by the asset owner
 * or a valid executive delegate. Funds for the agent go HERE, never to the
 * Core asset account itself (see docs/two-wallets.md).
 */
export function deriveAssetSignerPda(asset: PublicKey | string): PublicKey {
  const assetKey = typeof asset === "string" ? new PublicKey(asset) : asset;
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(ASSET_SIGNER_SEED, "utf8"), assetKey.toBuffer()],
    MPL_CORE_PROGRAM_ID,
  );
  return pda;
}
