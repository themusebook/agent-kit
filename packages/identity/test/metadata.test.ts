import { describe, expect, it } from "vitest";
import {
  buildRegistrationDocument,
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
  });

  it("rejects ephemeral image hosts", () => {
    const bad = { ...good, image: "https://example.com/img.png" };
    expect(validateRegistrationDocument(bad).join(" ")).toMatch(/ipfs/);
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
