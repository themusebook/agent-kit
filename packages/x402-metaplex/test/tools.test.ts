import { describe, expect, it } from "vitest";
import { SpendGuard } from "../src/guard.js";
import { createX402Tools } from "../src/tools.js";
import { openAIOptions, vercelProviderOptions } from "../src/providers.js";
import { signerFromEnv } from "../src/payers.js";

describe("x402 tools", () => {
  const guard = new SpendGuard();
  const seen: string[] = [];
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    seen.push(`${init?.method} ${url} ${init?.body}`);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
  const tools = createX402Tools({ fetch: fakeFetch, guard });
  const t = (n: string) => tools.find((x) => x.name === n)!;

  it("exposes chat, image, rpc, das, discovery, delegate and budget tools", () => {
    expect(tools.map((x) => x.name)).toEqual([
      "x402_models", "x402_pricing", "x402_chat", "x402_image", "x402_rpc",
      "x402_das_get_asset", "x402_das_assets_by_owner", "x402_delegate_status",
      "x402_delegate_approve", "x402_delegate_revoke", "x402_budget",
    ]);
  });
  it("routes chat/image/rpc to the Metaplex x402 endpoints", async () => {
    await t("x402_chat").run({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "hi" }] });
    await t("x402_image").run({ model: "openai/gpt-image-1.5", prompt: "x" });
    await t("x402_das_get_asset").run({ id: "A" });
    expect(seen[0]).toMatch(/^POST https:\/\/api\.metaplex\.com\/x402\/chat\/completions/);
    expect(seen[1]).toMatch(/\/x402\/images\/generations/);
    expect(seen[2]).toMatch(/\/x402\/rpc .*"method":"getAsset"/);
  });
  it("delegate approve refuses without an owner/pay mode/confirm", async () => {
    await expect(t("x402_delegate_approve").run({ confirm: true })).rejects.toThrow(/owner not configured/);
  });
  it("budget reports discovery defaults", async () => {
    expect(await t("x402_budget").run({})).toMatchObject({ mode: "discovery", spentUsd: 0 });
  });
  it("providers use the x402 placeholder key and the paying fetch", () => {
    expect(openAIOptions(fakeFetch)).toMatchObject({ apiKey: "x402", baseURL: "https://api.metaplex.com/x402", fetch: fakeFetch });
    expect(vercelProviderOptions(fakeFetch).name).toBe("metaplex-x402");
  });
  it("signerFromEnv never echoes the key", async () => {
    await expect(signerFromEnv({})).rejects.toThrow(/not set/);
    const bad = "secretvalue123";
    await expect(signerFromEnv({ SVM_PRIVATE_KEY: bad })).rejects.toThrow(/not a valid/);
    await signerFromEnv({ SVM_PRIVATE_KEY: bad }).catch((e) => expect(String(e)).not.toContain(bad));
  });
});

import { delegateApprove } from "../src/payers.js";
describe("delegate approve guard", () => {
  it("refuses in discovery mode or without confirm, before any network call", async () => {
    const signer = {} as any;
    await expect(delegateApprove(signer, { asset: "A", rpcUrl: "x", guard: new SpendGuard(), confirm: true })).rejects.toMatchObject({ reason: "discovery_only" });
    await expect(delegateApprove(signer, { asset: "A", rpcUrl: "x", guard: new SpendGuard({ mode: "pay" }), confirm: false })).rejects.toMatchObject({ reason: "discovery_only" });
  });
});
