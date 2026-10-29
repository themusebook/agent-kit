import { describe, expect, it } from "vitest";
import { validateRegistrationDocument } from "@musebook/identity";
import {
  AGENT_TEMPLATES,
  buildTemplateRegistration,
  getAgentTemplate,
} from "../src/presets";

describe("template completeness", () => {
  it("ships exactly the seven venue presets, each fully specified", () => {
    expect(AGENT_TEMPLATES.map((t) => t.id)).toEqual([
      "x402-agent",
      "raydium-agent",
      "pump-agent",
      "stonk-agent",
      "rwa-agent",
      "perps-agent",
      "decision-agent",
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

describe("pump-agent v0.3 deepening", () => {
  const pump = getAgentTemplate("pump-agent");

  it("references the finance pump flow descriptors and the co-sign doctrine", () => {
    const notes = pump.finance.notes.join("\n");
    expect(notes).toMatch(/buildCreateCoinRequest/);
    expect(notes).toMatch(/buildSwapRequest/);
    expect(notes).toMatch(/buildAgentPaymentInvoice/);
    expect(notes).toMatch(/fun-block\.pump\.fun/);
    expect(notes).toMatch(/slippageBps is REQUIRED/);
    expect(notes).not.toMatch(/ships NO pump\.fun SDK/);
    expect(pump.sources.join(" ")).toMatch(/local-pump-agents-create-coin/);
  });
});

describe("stonk-agent v0.3 correction", () => {
  const stonk = getAgentTemplate("stonk-agent");

  it("supersedes the v0.2 launch-disabled claim with the stats-gated two-path model", () => {
    const all = [stonk.summary, ...stonk.finance.notes, ...stonk.requiredCaps].join("\n");
    expect(all).toMatch(/CORRECTION vs v0\.2/);
    expect(all).toMatch(/paidLaunchesEnabled/);
    expect(all).toMatch(/chooseLaunchPath/);
    expect(all).not.toMatch(/currently returns 503|API prepare-launch flow is currently DISABLED/);
    expect(stonk.sources.join(" ")).toMatch(/Official Stonkfun Developer API/);
  });

  it("carries the LaunchLab traps and claim error semantics", () => {
    const notes = stonk.finance.notes.join("\n");
    expect(notes).toMatch(/transferFeeBasePoints\/maxinumFee/);
    expect(notes).toMatch(/raise\.raw/);
    expect(notes).toMatch(/creator-quote-vault/);
    expect(notes).toMatch(/403 = no creator position/);
  });
});

describe("perps-agent + decision-agent grounding (v0.3)", () => {
  it("perps-agent covers the real topology: Phoenix venue, Imperial router, preflight model", () => {
    const perps = getAgentTemplate("perps-agent");
    const all = [perps.summary, ...perps.finance.notes, ...perps.requiredCaps].join("\n");
    expect(all).toMatch(/multi-underwriter ROUTER/);
    expect(all).toMatch(/buildPreflightReport/);
    expect(all).toMatch(/placeBatch/);
    expect(all).toMatch(/PERPS_SIM_ONLY/);
    expect(all).toMatch(/CLAMPS oversize/);
    expect(all).not.toMatch(/slPrice|money\.ts|agentgateway/);
    expect(perps.sources.join(" ")).toMatch(/clawd-agents-perps/);
    expect(perps.sources.join(" ")).toMatch(/clawd-perps-agent/);
  });

  it("decision-agent encodes fail-closed judging and recall-never-widens", () => {
    const decision = getAgentTemplate("decision-agent");
    const all = [decision.summary, ...decision.finance.notes, ...decision.requiredCaps].join("\n");
    expect(all).toMatch(/BLOCKED/);
    expect(all).toMatch(/never widens the action space/);
    expect(all).toMatch(/buildActionSpace/);
    expect(all).toMatch(/allowLive: true/);
    expect(decision.sources.join(" ")).toMatch(/jev-trader-solana/);
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
