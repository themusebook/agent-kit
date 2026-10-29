import { describe, expect, it } from "vitest";
import { deriveAssetSignerPda } from "@themusebook/agent-kit-identity";
import { buildSetAgentTokenV1 } from "../src/setAgentToken";
import { PermanentBindingRefusalError } from "../src/errors";

const ASSET = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";
const MINT = "TokenMint1111111111111111111111111111111111";

describe("buildSetAgentTokenV1 — permanence gate", () => {
  it("REFUSES without explicit acknowledgePermanent: true", () => {
    expect(() => buildSetAgentTokenV1({ asset: ASSET, tokenMint: MINT })).toThrowError(
      PermanentBindingRefusalError,
    );
    expect(() =>
      buildSetAgentTokenV1({ asset: ASSET, tokenMint: MINT, acknowledgePermanent: false }),
    ).toThrowError(/PERMANENT and one-shot/);
  });

  it("builds a Core-Execute descriptor once acknowledged", () => {
    const d = buildSetAgentTokenV1({
      asset: ASSET,
      tokenMint: MINT,
      acknowledgePermanent: true,
    });
    expect(d.kind).toBe("setAgentTokenV1");
    expect(d.via).toBe("core-execute");
    expect(d.permanent).toBe(true);
    // The executing authority is the keyless Asset Signer PDA.
    expect(d.assetSigner).toBe(deriveAssetSignerPda(ASSET).toBase58());
    expect(d.tokenMint).toBe(MINT);
  });

  it("still validates pubkeys after the gate", () => {
    expect(() =>
      buildSetAgentTokenV1({ asset: "nope", tokenMint: MINT, acknowledgePermanent: true }),
    ).toThrowError(/asset/);
  });
});
