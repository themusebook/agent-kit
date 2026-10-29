import { describe, expect, it } from "vitest";
import { deriveAssetSignerPda, MPL_CORE_PROGRAM_ID } from "../src/assetSigner";
import { PublicKey } from "@solana/web3.js";

describe("deriveAssetSignerPda", () => {
  it("matches the verified mainnet golden vector (Musebook house agent)", () => {
    // House agent asset + its Asset Signer PDA, both verified onchain and
    // recorded in the kit architecture doc.
    const asset = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";
    expect(deriveAssetSignerPda(asset).toBase58()).toBe(
      "AgZH58XPLZnxpS1cxZL22vRoDio53Y6m6gLQtpTnb3QK",
    );
  });

  it("is deterministic and asset-specific", () => {
    const a = deriveAssetSignerPda("CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU");
    const b = deriveAssetSignerPda("CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU");
    expect(a.equals(b)).toBe(true);
    const other = Keypair_asset();
    expect(deriveAssetSignerPda(other).equals(a)).toBe(false);
  });

  it("derives under the MPL Core program", () => {
    const [expected] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("mpl-core-execute"),
        new PublicKey("CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU").toBuffer(),
      ],
      MPL_CORE_PROGRAM_ID,
    );
    expect(
      deriveAssetSignerPda("CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU").equals(expected),
    ).toBe(true);
  });
});

function Keypair_asset(): string {
  return "11111111111111111111111111111111";
}
