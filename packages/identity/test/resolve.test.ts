import { describe, expect, it } from "vitest";
import {
  resolveFromDirectoryRecord,
  verifyDirectoryRecord,
} from "../src/resolve";
import { deriveAssetSignerPda } from "../src/assetSigner";

// A real record from the live directory snapshot (live/agents.json).
const liveRecord = {
  assetId: "JE2eBLsBzQzwo77tBQJg4NyCsMCem8cJbhk7RxGGdTBr",
  name: "Simply Lovely",
  network: "mainnet",
  metadataUri: "https://spawnagents.fun/api/agent-meta?id=agent_395c0bcd",
  assetSigner: "FsdeXruviePzguN8QtCjA83NiCTsTWhNhRLFMTFJMs7h",
  update_authority: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e",
};

describe("resolveFromDirectoryRecord", () => {
  it("resolves the live snapshot spelling without an RPC", () => {
    const r = resolveFromDirectoryRecord(liveRecord);
    expect(r.exists).toBe(true);
    expect(r.isAgent).toBe(true);
    expect(r.owner).toBe(liveRecord.update_authority);
    expect(r.registrationUri).toBe(liveRecord.metadataUri);
    // The record's claimed signer must equal the locally derived PDA.
    expect(r.assetSigner).toBe(deriveAssetSignerPda(liveRecord.assetId).toBase58());
    expect(r.assetSigner).toBe(liveRecord.assetSigner);
    expect(verifyDirectoryRecord(liveRecord)).toEqual([]);
  });

  it("resolves the agents-repo spelling (updateAuthority)", () => {
    const r = resolveFromDirectoryRecord({
      assetId: "AHqPaqRTtipq6HzkFwaGwW883GjWm6zshe4B6PYYaUJh",
      assetSigner: "FmYCcQBMGJf3oPVXkcMmQVtKaUi4sWjATXHy1LN5TjAR",
      updateAuthority: "5Cs1wVkf8VnwMdGUUAg4gHxZLKqt5FWXTJkaCAGoSZyC",
      metadataUri: "https://example.com/meta.json",
    });
    expect(r.isAgent).toBe(true);
    expect(r.owner).toBe("5Cs1wVkf8VnwMdGUUAg4gHxZLKqt5FWXTJkaCAGoSZyC");
  });

  it("does not bless a record whose signer is not the derived PDA", () => {
    const lying = { ...liveRecord, assetSigner: liveRecord.update_authority };
    const r = resolveFromDirectoryRecord(lying);
    expect(r.isAgent).toBe(false);
    expect(verifyDirectoryRecord(lying)).toContain(
      "record assetSigner does not match the derived Asset Signer PDA",
    );
  });
});
