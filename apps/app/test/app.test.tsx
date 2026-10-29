import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { App, DirectoryView, IdentityCard, JobsView, MessagingView, TABS } from "../src/App";
import type { Api } from "../src/api";

const never = () => new Promise<never>(() => {});
const api = { health: never, directory: never, x402m: never, routines: never } as unknown as Api;

describe("dashboard", () => {
  it("renders the shell with every tab", () => {
    const html = renderToStaticMarkup(<App api={api} network="devnet" />);
    for (const t of TABS) expect(html).toContain(`>${t}<`);
  });
  it("mint tab says the wallet signs, and has no key inputs", () => {
    const html = renderToStaticMarkup(<App api={api} initialTab="Mint" network="devnet" />);
    expect(html).toContain("asks your wallet to sign");
    expect(html.toLowerCase()).not.toMatch(/private key|secret key|seed phrase/);
  });
  it("renders directory, messaging, jobs and identity views", () => {
    const snap = { generatedAt: null, totalAgents: 1, byNetwork: null, agents: [{ id: "1", name: "musebot", assetId: "A", network: "solana-mainnet" } as any] };
    expect(renderToStaticMarkup(<DirectoryView snapshot={snap} query="" />)).toContain("musebot");
    expect(renderToStaticMarkup(<MessagingView x402m={{ endpoint: "e", capabilities: ["x402m.send"], contentProfiles: [], raw: {} }} routines={[]} />)).toContain("x402m.send");
    expect(renderToStaticMarkup(<JobsView routines={[{ id: "r", agentId: "a", kind: "openbot.turn", intervalSeconds: 60, nextRunAt: 0 }]} />)).toContain("openbot.turn");
    expect(renderToStaticMarkup(<IdentityCard agent={{ assetAddress: "A", exists: true, isAgent: true, owner: "O", name: "n", registrationUri: "ipfs://r", assetSigner: "P", agentToken: null, raw: null }} />)).toContain("Agent Identity binding");
  });
});
