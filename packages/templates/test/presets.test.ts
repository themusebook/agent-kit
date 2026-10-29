import { describe, expect, it } from "vitest";
import { validateRegistrationDocument } from "@themusebook/agent-kit-identity";
import {
  AGENT_TEMPLATES,
  buildTemplateRegistration,
  getAgentTemplate,
} from "../src/presets";

describe("template completeness", () => {
  it("ships exactly the five venue presets, each fully specified", () => {
    expect(AGENT_TEMPLATES.map((t) => t.id)).toEqual([
      "x402-agent",
      "raydium-agent",
      "pump-agent",
      "stonk-agent",
      "rwa-agent",
    ]);
    for (const t of AGENT_TEMPLATES) {
      expect(t.services.length).toBeGreaterThan(0);
      expect(t.requiredCaps.length).toBeGreaterThan(0);
      expect(t.sources.length).toBeGreaterThan(0);
      expect(t.finance.notes.length).toBeGreaterThan(0);
      expect(t.supportedTrust.length).toBeGreaterThan(0);
    }
  });

  it("only the x402 preset advertises x402Support", () => {
    for (const t of AGENT_TEMPLATES) {
      expect(t.x402Support).toBe(t.id === "x402-agent");
    }
  });

  it("builds a valid registration document from a preset", () => {
    const doc = buildTemplateRegistration("x402-agent", {
      name: "Paid Tools Agent",
      description: "Sells tool calls over x402",
      image: "ipfs://bafybeigdtestimage",
      endpoints: { x402: "https://agent.example/pay", MCP: "https://agent.example/mcp" },
    });
    expect(validateRegistrationDocument(doc)).toEqual([]);
    expect(doc.x402Support).toBe(true);
    expect(doc.services[0]?.domains).toContain("payments");
  });

  it("refuses to invent an endpoint", () => {
    expect(() =>
      buildTemplateRegistration("rwa-agent", {
        name: "R",
        description: "D",
        image: "ipfs://bafybeigdtestimage",
        endpoints: { RWA: "https://agent.example/rwa" }, // trading endpoint missing
      }),
    ).toThrowError(/no endpoint supplied for service "trading"/);
  });
});

describe("rwa-agent grounding (owner's RWA repo)", () => {
  const rwa = getAgentTemplate("rwa-agent");

  it("carries the pairing + permanence rules from the repos", () => {
    const caps = rwa.requiredCaps.join("\n");
    expect(caps).toMatch(/ONE agent per RWA asset unless replace: true/);
    expect(caps).toMatch(/setToken is one-shot and permanent/);
    expect(caps).toMatch(/transfer_ownership/);
    expect(caps).toMatch(/accounts\.from === pairing\.assetSigner/);
    expect(caps).toMatch(/RealEstate/);
    expect(caps).toMatch(/set_asset_status/);
  });

  it("cites the single RWA repo and its concrete files as sources", () => {
    const sources = rwa.sources.join("\n");
    expect(sources).toMatch(/themusebook\/solana-rwa-agents/);
    expect(sources).toMatch(/programs\/rwa-tokenization/);
    expect(sources).toMatch(/docs\/agent-pairing\.md/);
    // Former name is noted as a rename, never as a separate live repo.
    expect(sources).toMatch(/Solana-RWA-Smart-Contract was the FORMER NAME/);
    expect(sources).toMatch(/not a separate live repo/);
  });

  it("launches through the Genesis bonding curve like the RWA stack", () => {
    expect(rwa.finance.launchRoute).toBe("genesis-bonding-curve");
    expect(rwa.finance.notes.join(" ")).toMatch(/shapeCreateAndRegisterLaunch/);
  });
});
