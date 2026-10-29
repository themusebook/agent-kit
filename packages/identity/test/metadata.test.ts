import { describe, expect, it } from "vitest";
import {
  buildAgentMetadata,
  buildRegistrationDocument,
  METAPLEX_REGISTRY,
  toMetaplexNetwork,
  validateAgentMetadata,
  validateRegistrationDocument,
} from "../src/metadata";

describe("registration document", () => {
  const good = buildRegistrationDocument({
    name: "test-agent",
    description: "A test agent",
    image: "ipfs://bafybeigdtestimage",
    agentId: "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU",
    services: [{ name: "MCP", endpoint: "https://musebook.trade/mcp" }],
  });

  it("builds a valid document", () => {
    expect(validateRegistrationDocument(good)).toEqual([]);
    expect(good.registrations[0]?.agentRegistry).toBe("solana:101:metaplex");
    expect(good.registrations[0]?.agentRegistry).toBe(METAPLEX_REGISTRY);
    expect(good.x402Support).toBe(false);
  });

  it("requires an image (EIP-8004 shape)", () => {
    const bad = { ...good, image: "" };
    expect(validateRegistrationDocument(bad).join(" ")).toMatch(/image is required/);
  });

  it("rejects ephemeral image hosts", () => {
    const bad = { ...good, image: "https://example.com/img.png" };
    expect(validateRegistrationDocument(bad).join(" ")).toMatch(/permanent/);
  });

  it("accepts Irys gateway image URLs (owner RWA stack convention)", () => {
    const ok = { ...good, image: "https://gateway.irys.xyz/abc123" };
    expect(validateRegistrationDocument(ok)).toEqual([]);
  });

  it("carries x402Support and rich service entries", () => {
    const doc = buildRegistrationDocument({
      name: "pay-agent",
      description: "Paid services",
      image: "ipfs://bafybeigdtestimage",
      x402Support: true,
      services: [
        {
          name: "MCP",
          endpoint: "https://musebook.trade/mcp",
          version: "1.0",
          skills: ["x402-facilitator"],
          domains: ["payments"],
        },
      ],
    });
    expect(validateRegistrationDocument(doc)).toEqual([]);
    expect(doc.x402Support).toBe(true);
    const bad = { ...doc, x402Support: "yes" as unknown as boolean };
    expect(validateRegistrationDocument(bad).join(" ")).toMatch(/x402Support/);
  });

  it("rejects unknown trust modes", () => {
    const bad = { ...good, supportedTrust: ["vibes"] };
    expect(validateRegistrationDocument(bad).join(" ")).toMatch(/trust mode/);
  });

  it("rejects a foreign registry reference", () => {
    const bad = {
      ...good,
      registrations: [{ agentId: "x", agentRegistry: "eip155:1:elsewhere" }],
    };
    expect(validateRegistrationDocument(bad).length).toBeGreaterThan(0);
  });

  it("rejects non-objects", () => {
    expect(validateRegistrationDocument("nope").length).toBeGreaterThan(0);
    expect(validateRegistrationDocument(null).length).toBeGreaterThan(0);
  });
});

describe("hosted-API agentMetadata (distinct from the registration document)", () => {
  it("builds the documented shape with type 'agent'", () => {
    const meta = buildAgentMetadata({
      name: "My AI Agent",
      description: "An autonomous trading agent",
      services: [{ name: "trading", endpoint: "https://myagent.ai/trade" }],
      supportedTrust: ["tee"],
    });
    expect(meta.type).toBe("agent");
    expect(validateAgentMetadata(meta)).toEqual([]);
  });

  it("requires name and description", () => {
    expect(validateAgentMetadata({ type: "agent", name: "", description: "" }).join(" "))
      .toMatch(/description is required/);
    expect(validateAgentMetadata({ type: "agent", description: "d" }).join(" "))
      .toMatch(/name is required/);
    expect(validateAgentMetadata({ type: "other", name: "n", description: "d" }).join(" "))
      .toMatch(/type must be "agent"/);
  });

  it("maps kit networks onto hosted-API network values", () => {
    expect(toMetaplexNetwork("devnet")).toBe("solana-devnet");
    expect(toMetaplexNetwork("mainnet-beta")).toBe("solana-mainnet");
    expect(toMetaplexNetwork(undefined)).toBe("solana-mainnet");
  });
});
