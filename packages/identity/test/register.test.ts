import { afterEach, describe, expect, it, vi } from "vitest";
import type { TransactionSigner } from "@musebook/wallet";
import {
  buildAgentMint,
  buildRegisterIdentityV1,
  registerIdentity,
  validateRegisterIdentityInput,
} from "../src/register";
import {
  isAgentApiError,
  isAgentApiNetworkError,
  isAgentValidationError,
} from "../src/errors";
import { MPL_AGENT_REGISTRY_PROGRAM_ID } from "../src/assetSigner";

const signer: TransactionSigner = {
  publicKey: "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e",
  signMessage: async (m) => m,
  signTransaction: async (tx) => `signed:${tx}`,
};

const config = { rpc: "https://rpc.example", network: "mainnet-beta" as const };
const ASSET = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface SeenRequest {
  url: string;
  body: Record<string, unknown>;
}

/** Mock fetch: hosted API on api.metaplex.com, JSON-RPC on rpc.example. */
function mockFetch(opts: {
  mintStatus?: number;
  mintBody?: unknown;
  networkThrow?: boolean;
  seen?: SeenRequest[];
}) {
  return vi.fn(async (url: string, init?: { body?: string }) => {
    const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    opts.seen?.push({ url, body });
    if (url.includes("api.metaplex.com")) {
      if (opts.networkThrow) throw new Error("socket hangup");
      return jsonResponse(
        opts.mintBody ?? { transaction: "unsigned-tx", assetAddress: ASSET },
        opts.mintStatus ?? 200,
      );
    }
    // JSON-RPC
    if (body.method === "sendTransaction") return jsonResponse({ result: "sig123" });
    if (body.method === "getSignatureStatuses") {
      return jsonResponse({
        result: { value: [{ confirmationStatus: "finalized", err: null }] },
      });
    }
    return jsonResponse({ result: null });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("buildAgentMint (hosted API step)", () => {
  it("sends uri and agentMetadata as two distinct fields, network solana-mainnet", async () => {
    const seen: SeenRequest[] = [];
    vi.stubGlobal("fetch", mockFetch({ seen }));
    const built = await buildAgentMint(config, {
      signer,
      name: "Agent One",
      uri: "https://example.com/agent-metadata.json",
      agentMetadata: {
        name: "Agent One",
        description: "Does things",
        services: [{ name: "trading", endpoint: "https://a.ai/trade" }],
        supportedTrust: ["tee"],
      },
    });
    expect(built.transaction).toBe("unsigned-tx");
    expect(built.assetAddress).toBe(ASSET);
    expect(built.network).toBe("solana-mainnet");
    const req = seen[0]!;
    expect(req.url).toBe("https://api.metaplex.com/v1/agents/mint");
    expect(req.body.uri).toBe("https://example.com/agent-metadata.json");
    expect(req.body.network).toBe("solana-mainnet");
    expect(req.body.wallet).toBe(signer.publicKey);
    const meta = req.body.agentMetadata as Record<string, unknown>;
    expect(meta.type).toBe("agent");
    expect(meta.description).toBe("Does things");
    expect(meta.supportedTrust).toEqual(["tee"]);
  });

  it("fails client-side with AgentValidationError naming the field", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const problems = validateRegisterIdentityInput(config, { signer, name: "X" });
    expect(problems.map((p) => p.field)).toContain("uri");
    expect(problems.map((p) => p.field)).toContain("agentMetadata.description");
    await expect(
      buildAgentMint(config, { signer, name: "X", uri: "https://e.com/m.json" }),
    ).rejects.toSatisfy(
      (e: unknown) => isAgentValidationError(e) && e.field === "agentMetadata.description",
    );
  });

  it("maps non-2xx to AgentApiError with status + body", async () => {
    vi.stubGlobal("fetch", mockFetch({ mintStatus: 400, mintBody: { error: "bad" } }));
    await expect(
      buildAgentMint(config, {
        signer,
        uri: "https://e.com/m.json",
        agentMetadata: { name: "A", description: "D" },
      }),
    ).rejects.toSatisfy(
      (e: unknown) => isAgentApiError(e) && e.statusCode === 400,
    );
  });

  it("maps fetch failure to AgentApiNetworkError", async () => {
    vi.stubGlobal("fetch", mockFetch({ networkThrow: true }));
    await expect(
      buildAgentMint(config, {
        signer,
        uri: "https://e.com/m.json",
        agentMetadata: { name: "A", description: "D" },
      }),
    ).rejects.toSatisfy((e: unknown) => isAgentApiNetworkError(e));
  });
});

describe("registerIdentity (build + sign + submit)", () => {
  it("signs with the caller signer and broadcasts via RPC", async () => {
    vi.stubGlobal("fetch", mockFetch({}));
    const result = await registerIdentity(config, {
      signer,
      uri: "https://e.com/m.json",
      agentMetadata: { name: "A", description: "D" },
    });
    expect(result.signature).toBe("sig123");
    expect(result.assetAddress).toBe(ASSET);
    expect(result.assetSigner).toBeTruthy();
    expect(result.agentIdentity).toBeTruthy();
    expect(result.metadataUri).toBe("https://e.com/m.json");
  });

  it("routes broadcast through a caller txSender when provided", async () => {
    const seen: SeenRequest[] = [];
    vi.stubGlobal("fetch", mockFetch({ seen }));
    const result = await registerIdentity(config, {
      signer,
      uri: "https://e.com/m.json",
      agentMetadata: { name: "A", description: "D" },
      txSender: async (signed) => {
        expect(signed).toBe("signed:unsigned-tx");
        return "custom-sig";
      },
    });
    expect(result.signature).toBe("custom-sig");
    // No RPC sendTransaction happened.
    expect(seen.some((r) => r.body.method === "sendTransaction")).toBe(false);
  });

  it("devnet config maps to solana-devnet", async () => {
    const seen: SeenRequest[] = [];
    vi.stubGlobal("fetch", mockFetch({ seen }));
    await buildAgentMint(
      { rpc: config.rpc, network: "devnet" },
      { signer, uri: "https://e.com/m.json", agentMetadata: { name: "A", description: "D" } },
    );
    expect(seen[0]!.body.network).toBe("solana-devnet");
  });
});

describe("buildRegisterIdentityV1 (existing-asset path)", () => {
  it("builds a one-time descriptor for an existing asset", () => {
    const d = buildRegisterIdentityV1({
      asset: ASSET,
      agentRegistrationUri: "ipfs://bafybeigdtestdoc",
      authority: signer.publicKey,
    });
    expect(d.kind).toBe("registerIdentityV1");
    expect(d.program).toBe(MPL_AGENT_REGISTRY_PROGRAM_ID.toBase58());
    expect(d.oneTimePerAsset).toBe(true);
    expect(d.agentIdentityPda).toBeTruthy();
    expect(d.assetSigner).toBeTruthy();
    expect(d.payer).toBe(signer.publicKey); // defaults to authority
    expect(d.collection).toBeNull();
  });

  it("rejects bad assets and missing URIs with fielded validation errors", () => {
    expect(() =>
      buildRegisterIdentityV1({ asset: "not-a-key", agentRegistrationUri: "ipfs://x" }),
    ).toThrowError(/asset/);
    expect(() =>
      buildRegisterIdentityV1({ asset: ASSET, agentRegistrationUri: "" }),
    ).toThrowError(/agentRegistrationUri/);
  });
});
