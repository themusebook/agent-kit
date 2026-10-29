import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAgent,
  normalizeSnapshot,
  searchDirectory,
} from "../src/registry";

const config = { hub: "https://musebook.trade", registry: "https://registry.musebook.trade" };

// A real record from the live snapshot (musebook.trade/live/agents.json).
const liveRecord = {
  assetId: "JE2eBLsBzQzwo77tBQJg4NyCsMCem8cJbhk7RxGGdTBr",
  name: "Simply Lovely",
  network: "mainnet",
  image: "https://spawnagents.fun/S.jpg",
  metadataUri: "https://spawnagents.fun/api/agent-meta?id=agent_395c0bcd",
  assetSigner: "FsdeXruviePzguN8QtCjA83NiCTsTWhNhRLFMTFJMs7h",
  interface: "MplCoreAsset",
  description: "Autonomous trading agent on Solana spawned via SPAWN.",
  json_uri: "https://spawnagents.fun/api/agent-meta?id=agent_395c0bcd",
  update_authority: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e",
};

// The same population as carried by themusebook/agents (musebook/agents.json):
// camelCase envelope fields — identifier + updateAuthority.
const repoRecord = {
  identifier: "00dao-base-eth-ahqpaqrt",
  name: "00dao.base.eth",
  network: "mainnet",
  source: "musebook",
  assetId: "AHqPaqRTtipq6HzkFwaGwW883GjWm6zshe4B6PYYaUJh",
  assetSigner: "FmYCcQBMGJf3oPVXkcMmQVtKaUi4sWjATXHy1LN5TjAR",
  updateAuthority: "5Cs1wVkf8VnwMdGUUAg4gHxZLKqt5FWXTJkaCAGoSZyC",
  metadataUri: "https://example.com/meta.json",
};

describe("normalizeAgent", () => {
  it("reads the live snapshot spelling (assetId + update_authority)", () => {
    const a = normalizeAgent(liveRecord);
    expect(a.assetId).toBe(liveRecord.assetId);
    expect(a.assetAddress).toBe(liveRecord.assetId);
    expect(a.wallet).toBe(liveRecord.update_authority);
    expect(a.ownerWallet).toBe(liveRecord.update_authority);
    expect(a.updateAuthority).toBe(liveRecord.update_authority);
    expect(a.assetSigner).toBe(liveRecord.assetSigner);
    expect(a.metadataUri).toBe(liveRecord.metadataUri);
    expect(a.network).toBe("mainnet");
  });

  it("reads the agents-repo spelling (identifier + updateAuthority)", () => {
    const a = normalizeAgent(repoRecord);
    expect(a.id).toBe("00dao-base-eth-ahqpaqrt");
    expect(a.assetId).toBe(repoRecord.assetId);
    expect(a.ownerWallet).toBe(repoRecord.updateAuthority);
  });

  it("still reads the hub API spelling (id + ownerWallet + assetAddress)", () => {
    const a = normalizeAgent({
      id: "ag_1",
      name: "Api Agent",
      ownerWallet: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e",
      assetAddress: "JE2eBLsBzQzwo77tBQJg4NyCsMCem8cJbhk7RxGGdTBr",
    });
    expect(a.id).toBe("ag_1");
    expect(a.wallet).toBe("GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e");
    expect(a.assetId).toBe("JE2eBLsBzQzwo77tBQJg4NyCsMCem8cJbhk7RxGGdTBr");
  });
});

describe("normalizeSnapshot", () => {
  it("reads the live envelope (generated_at / total_agents / by_network)", () => {
    const snap = normalizeSnapshot({
      generated_at: "2026-10-26T02:36:24.948914+00:00",
      total_agents: 1444,
      by_network: { mainnet: 1000, devnet: 444 },
      agents: [liveRecord],
    });
    expect(snap.totalAgents).toBe(1444);
    expect(snap.byNetwork).toEqual({ mainnet: 1000, devnet: 444 });
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0].name).toBe("Simply Lovely");
  });
});

describe("searchDirectory fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the snapshot when the directory API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/v2/agents")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        if (url.includes("/live/agents.json")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              generated_at: "2026-10-26T02:36:24Z",
              total_agents: 1,
              by_network: { mainnet: 1 },
              agents: [liveRecord],
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const hits = await searchDirectory(config, "simply");
    expect(hits).toHaveLength(1);
    expect(hits[0].assetId).toBe(liveRecord.assetId);
    const none = await searchDirectory(config, "no-such-agent-xyz");
    expect(none).toHaveLength(0);
  });
});
