import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAgentIdentity,
  resolveAgent,
  resolveFromDirectoryRecord,
  searchAgentAssets,
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

const DAS_ASSET = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";
const DAS_CONFIG = { rpc: "https://rpc.example" };

function mockDas(asset: Record<string, unknown> | null, seen?: Array<Record<string, unknown>>) {
  return vi.fn(async (_url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    seen?.push(body);
    const result =
      body.method === "searchAssets" ? { items: asset ? [asset] : [] } : asset;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "agent-kit", result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("resolveAgent against DAS getAsset shapes", () => {
  it("parses snake_case is_agent / agent_token and lifecycle hooks", async () => {
    vi.stubGlobal(
      "fetch",
      mockDas({
        id: DAS_ASSET,
        is_agent: true,
        asset_signer: deriveAssetSignerPda(DAS_ASSET).toBase58(),
        agent_token: "TokenMint1111111111111111111111111111111111",
        ownership: { owner: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e" },
        content: { metadata: { name: "House Agent" } },
        plugins: {
          agentIdentity: {
            data: {
              uri: "ipfs://bafybeigdregistration",
              lifecycle_checks: {
                transfer: { __kind: "Listen" },
                update: { __kind: "Listen" },
                execute: { __kind: "Listen" },
              },
            },
          },
        },
      }),
    );
    const r = await resolveAgent(DAS_CONFIG, DAS_ASSET);
    expect(r.isAgent).toBe(true);
    expect(r.agentToken).toBe("TokenMint1111111111111111111111111111111111");
    expect(r.registrationUri).toBe("ipfs://bafybeigdregistration");
    expect(r.lifecycleChecks).toEqual({ transfer: true, update: true, execute: true });
    expect(r.agentIdentity).toBeTruthy();
    const identity = await fetchAgentIdentity(DAS_CONFIG, DAS_ASSET);
    expect(identity?.assetAddress).toBe(DAS_ASSET);
  });

  it("treats agent_token as optional — absent until setAgentTokenV1 binds one", async () => {
    vi.stubGlobal(
      "fetch",
      mockDas({
        id: DAS_ASSET,
        is_agent: true,
        ownership: { owner: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e" },
        plugins: { agentIdentity: { data: { uri: "ipfs://bafybeigdregistration" } } },
      }),
    );
    const r = await resolveAgent(DAS_CONFIG, DAS_ASSET);
    expect(r.isAgent).toBe(true);
    expect(r.agentToken).toBeNull();
    expect(r.lifecycleChecks).toBeNull();
  });

  it("is_agent=false wins: a derivable signer PDA alone never makes an agent", async () => {
    vi.stubGlobal(
      "fetch",
      mockDas({
        id: DAS_ASSET,
        is_agent: false,
        asset_signer: deriveAssetSignerPda(DAS_ASSET).toBase58(),
        ownership: { owner: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e" },
      }),
    );
    const r = await resolveAgent(DAS_CONFIG, DAS_ASSET);
    expect(r.exists).toBe(true);
    expect(r.isAgent).toBe(false);
    // safeFetch semantics: unregistered assets resolve to null, never throw.
    expect(await fetchAgentIdentity(DAS_CONFIG, DAS_ASSET)).toBeNull();
  });

  it("returns null (not a throw) for a missing asset", async () => {
    vi.stubGlobal("fetch", mockDas(null));
    expect(await fetchAgentIdentity(DAS_CONFIG, DAS_ASSET)).toBeNull();
  });

  it("searchAssets sends camelCase params with the MplCoreAsset interface", async () => {
    const seen: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", mockDas({ id: DAS_ASSET, is_agent: true }, seen));
    const items = await searchAgentAssets(DAS_CONFIG, { agentToken: "MintX" });
    expect(items).toHaveLength(1);
    const params = seen[0]!.params as Record<string, unknown>;
    expect(params.interface).toBe("MplCoreAsset");
    expect(params.isAgent).toBe(true);
    expect(params.agentToken).toBe("MintX");
    expect(params).not.toHaveProperty("is_agent");
  });
});
