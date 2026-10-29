import { describe, expect, it } from "vitest";
import { SpendGuard, SpendGuardError, parseChallenge, spendGuardFromEnv, USDC_MAINNET } from "../src/guard.js";

const challenge = (amount: string, asset = USDC_MAINNET) =>
  Buffer.from(JSON.stringify({
    x402Version: 2,
    accepts: [{ scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", amount, asset, payTo: "9AYgwvWMhZuir6rZoto13jrU1oZA1XxRDhqPznxyomHv" }],
  })).toString("base64");

const res402 = (amount: string, asset?: string) =>
  new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": challenge(amount, asset) } });

describe("parseChallenge", () => {
  it("decodes the v2 base64 header into USD", () => {
    const c = parseChallenge(challenge("1000"));
    expect(c.x402Version).toBe(2);
    expect(c.accepts[0].amountUsd).toBe(0.001);
  });
  it("rejects garbage", () => {
    expect(() => parseChallenge("not-base64-json")).toThrow(SpendGuardError);
  });
});

describe("SpendGuard", () => {
  it("defaults to discovery-only and never pays", async () => {
    const g = new SpendGuard();
    const f = g.wrapInnerFetch(async () => res402("1000"));
    await expect(f("https://x/chat")).rejects.toMatchObject({ reason: "discovery_only" });
    expect(g.spent).toBe(0);
  });
  it("refuses over the per-request cap", async () => {
    const g = new SpendGuard({ mode: "pay", maxPerRequestUsd: 0.01 });
    const f = g.wrapInnerFetch(async () => res402("20000"));
    await expect(f("https://x")).rejects.toMatchObject({ reason: "over_request_cap" });
  });
  it("refuses unknown assets", async () => {
    const g = new SpendGuard({ mode: "pay" });
    const f = g.wrapInnerFetch(async () => res402("1000", "So11111111111111111111111111111111111111112"));
    await expect(f("https://x")).rejects.toMatchObject({ reason: "asset_not_allowed" });
  });
  it("tracks the session budget across paid retries", async () => {
    const g = new SpendGuard({ mode: "pay", maxPerRequestUsd: 0.01, sessionBudgetUsd: 0.015 });
    let n = 0;
    const inner = async (input: string | URL | Request) => {
      const r = input as Request;
      if (r.headers?.has?.("PAYMENT-SIGNATURE")) return new Response("{}", { status: 200 });
      n++; return res402("10000");
    };
    const f = g.wrapInnerFetch(inner as typeof fetch);
    expect((await f(new Request("https://x"))).status).toBe(402);
    await f(new Request("https://x", { headers: { "PAYMENT-SIGNATURE": "sig" } }));
    expect(g.spent).toBeCloseTo(0.01);
    await expect(f(new Request("https://x"))).rejects.toMatchObject({ reason: "over_session_budget" });
    expect(n).toBe(2);
  });
  it("does not count a failed paid retry", async () => {
    const g = new SpendGuard({ mode: "pay" });
    const f = g.wrapInnerFetch((async (i: Request) => i.headers.has("X-PAYMENT") ? new Response("", { status: 500 }) : res402("1000")) as any);
    await f(new Request("https://x"));
    await f(new Request("https://x", { headers: { "X-PAYMENT": "p" } }));
    expect(g.spent).toBe(0);
    expect(g.remaining).toBe(0.25);
  });
  it("reads caps from env and stays discovery unless X402_MODE=pay", () => {
    expect(spendGuardFromEnv({}).mode).toBe("discovery");
    const g = spendGuardFromEnv({ X402_MODE: "pay", X402_MAX_PER_REQUEST_USD: "0.002", X402_SESSION_BUDGET_USD: "0.01" });
    expect([g.mode, g.maxPerRequestUsd, g.sessionBudgetUsd]).toEqual(["pay", 0.002, 0.01]);
  });
});
