import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { StonkClient, planClaim, planStonkLaunch, submitSignedClaim, buildLaunchLabInstructions, checkTax, transferFeeParams, LaunchGuardError, checkTradeInput } from "../src/stonk/index.ts";
import { decodeUnsignedTx } from "../src/unsigned.ts";
import { fixture, mockFetch } from "./helpers.ts";

const stats = fixture("stonk/stats.json");
const pairs = fixture("stonk/pairs.json");
const pricing = fixture("stonk/pricing-spyx.json");
const spec = fixture("stonk/openapi.json");
const SPYX = pricing.data.quote.mint;
const pair = pairs.data.pairs.find((p: any) => p.mint === SPYX);
const creator = Keypair.generate().publicKey;

const base = () => ({
  "GET /api/public/v1/stats": () => ({ body: stats }),
  "GET /api/public/v1/pairs": () => ({ body: pairs }),
  "GET /api/public/v1/launchlab/pricing": () => ({ body: pricing }),
});
const client = (routes: any, extra: any = {}) => new StonkClient({ fetch: mockFetch(routes).f as any, sleep: async () => {}, ...extra });

describe("spec coverage", () => {
  test("every endpoint the agent calls is in the OpenAPI spec", () => {
    const paths = Object.keys(spec.paths);
    for (const p of [
      "/api/public/v1/stats", "/api/public/v1/pairs", "/api/public/v1/launchlab/pricing", "/api/public/v1/launchlab/platforms",
      "/api/public/v1/tokens", "/api/public/v1/tokens/{mint}", "/api/public/v1/tokens/{mint}/fees",
      "/api/public/v1/tokens/{mint}/fees/claim/prepare", "/api/public/v1/tokens/{mint}/fees/claim/submit",
      "/api/public/v1/launches/{paymentSignature}", "/api/public/v1/launchlab/intent/{mint}", "/api/v2/launches/recent",
    ]) expect(paths).toContain(p);
    expect(spec.paths["/api/public/v1/tokens/{mint}/fees/claim/prepare"].post.requestBody.content["application/json"].schema.required).toEqual(["creatorWallet"]);
    expect(spec.paths["/api/public/v1/tokens/{mint}/fees/claim/submit"].post.requestBody.content["application/json"].schema.required).toEqual(["creatorWallet", "intentId", "signedTransaction"]);
  });
  test("the spec does not publish POST /launches/prepare or a submit step", () => {
    expect(spec.paths["/api/public/v1/launches/prepare"]).toBeUndefined();
  });
});

describe("LaunchLab build path", () => {
  test("derived configId, allowConfig and curveRule match pricing", () => {
    const { derived } = buildLaunchLabInstructions({ payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: pricing.data, mode: "standard", name: "A", symbol: "A", uri: "https://x/y.json" });
    expect(derived.configId).toBe(pricing.data.curve.configId);
    expect(derived.allowConfig).toBe(pricing.data.allowConfig.standard);
    expect(derived.curveRule).toBe(pricing.data.curveRule.standard);
    expect(derived.platformId).toBe(pricing.data.platform.standard);
    expect(derived.totalFundRaisingB).toBe(pricing.data.raise.raw);
  });

  test("create shape: TOKEN_2022 at keys[10], pair.tokenProgram at keys[11], allowConfig then curveRule read-only last", () => {
    const { instructions } = buildLaunchLabInstructions({ payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: pricing.data, mode: "standard", name: "A", symbol: "A", uri: "https://x/y.json" });
    expect(instructions).toHaveLength(2);
    const k = instructions[1]!.keys;
    expect(k[10]!.pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
    expect(k[11]!.pubkey.toBase58()).toBe(pair.tokenProgram);
    expect(k.at(-2)!.pubkey.toBase58()).toBe(pricing.data.allowConfig.standard);
    expect(k.at(-1)!.pubkey.toBase58()).toBe(pricing.data.curveRule.standard);
    expect(k.at(-2)!.isWritable || k.at(-1)!.isWritable).toBe(false);
  });

  test("a tampered configId stops the build", () => {
    const bad = structuredClone(pricing.data);
    bad.curve.configId = Keypair.generate().publicKey.toBase58();
    expect(() => buildLaunchLabInstructions({ payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: bad, mode: "standard", name: "A", symbol: "A", uri: "https://x" })).toThrow(/configId mismatch/);
  });

  test("a tampered curveRule stops the build", () => {
    const bad = structuredClone(pricing.data);
    bad.curveRule.standard = bad.curveRule.reward;
    expect(() => buildLaunchLabInstructions({ payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: bad, mode: "standard", name: "A", symbol: "A", uri: "https://x" })).toThrow(/curveRule mismatch/);
  });

  test("raise.raw must be a raw integer string", () => {
    const bad = structuredClone(pricing.data);
    bad.raise.raw = bad.raise.units;
    expect(() => buildLaunchLabInstructions({ payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: bad, mode: "standard", name: "A", symbol: "A", uri: "https://x" })).toThrow(/raise.raw/);
  });

  test("reward tax tiers come from modes.reward.transferFeeBps", () => {
    for (const bps of pricing.data.modes.reward.transferFeeBps) expect(() => checkTax(pricing.data, "reward", bps)).not.toThrow();
    expect(() => checkTax(pricing.data, "reward", 250)).toThrow(LaunchGuardError);
    expect(() => checkTax(pricing.data, "standard", 100)).toThrow(/no transfer fee/);
  });

  test("standardV2 is refused when the deployment has it off", () => {
    expect(pricing.data.standardV2Enabled).toBe(false);
    expect(() => checkTax(pricing.data, "standardV2", 100)).toThrow(/not enabled/);
    const on = { ...pricing.data, standardV2Enabled: true, modes: { ...pricing.data.modes, standardV2: { transferFeeBpsRange: [50, 500] } } };
    expect(() => checkTax(on, "standardV2", 500)).not.toThrow();
    expect(() => checkTax(on, "standardV2", 501)).toThrow(/outside/);
  });

  test("community mode needs communityMode.offeredOnThisQuote", () => {
    expect(() => checkTax(pricing.data, "community", 100)).not.toThrow();
    const off = { ...pricing.data, communityMode: { ...pricing.data.communityMode, offeredOnThisQuote: false } };
    expect(() => checkTax(off, "community", 100)).toThrow(/Community Mode/);
  });

  test("transfer fee keys are exactly transferFeeBasePoints and maxinumFee", () => {
    expect(Object.keys(transferFeeParams(100)).sort()).toEqual(["maxinumFee", "transferFeeBasePoints"]);
  });

  test("taxed launch refused until a standard launch is confirmed as launchlab", () => {
    const args = { payer: creator, creator, mint: Keypair.generate().publicKey, pair, pricing: pricing.data, mode: "reward" as const, transferFeeBps: 100, name: "A", symbol: "A", uri: "https://x" };
    expect(() => buildLaunchLabInstructions(args)).toThrow(/standard launch first/);
    expect(() => buildLaunchLabInstructions({ ...args, confirmedStandardLaunch: { mint: "x", launchpad: "raydium" } })).toThrow(/standard launch first/);
    const r = buildLaunchLabInstructions({ ...args, confirmedStandardLaunch: { mint: "x", launchpad: "launchlab" } });
    expect(r.derived.platformId).toBe(pricing.data.platform.reward);
    expect(r.derived.allowConfig).toBe(pricing.data.allowConfig.reward);
  });

  test("planStonkLaunch: tx partially signed by the ephemeral mint only; creator still signs", async () => {
    const c = client(base());
    const { tx, mint } = await planStonkLaunch(c, { creator: creator.toBase58(), quoteMint: SPYX, mode: "standard", name: "Test", symbol: "TST", uri: "https://x/y.json", recentBlockhash: "11111111111111111111111111111111", network: "mainnet-beta" });
    expect(tx.partiallySignedBy).toEqual([mint]);
    expect(tx.requiredSigners).toEqual([creator.toBase58()]);
    const v = decodeUnsignedTx(tx.base64);
    expect(v.signatures[0]!.every((b) => b === 0)).toBe(true);
    expect(v.signatures[1]!.some((b) => b !== 0)).toBe(true);
  });

  test("planStonkLaunch refuses a quote that is not LaunchLab-ready", async () => {
    await expect(planStonkLaunch(client(base()), { creator: creator.toBase58(), quoteMint: Keypair.generate().publicKey.toBase58(), mode: "standard", name: "T", symbol: "T", uri: "https://x", recentBlockhash: "11111111111111111111111111111111", network: "mainnet-beta" })).rejects.toThrow(/not a launchable/);
  });
});

describe("API flow and client", () => {
  test("two-call /launches flow refused while stats.config.paidLaunchesEnabled is false", async () => {
    expect(stats.data.config.paidLaunchesEnabled).toBe(false);
    await expect(client(base()).prepareLaunch({})).rejects.toThrow(/paidLaunchesEnabled=false/);
  });

  test("429 waits exactly Retry-After then retries", async () => {
    let n = 0;
    const waits: number[] = [];
    const c = new StonkClient({
      fetch: mockFetch({ "GET /api/public/v1/stats": () => (n++ === 0 ? { status: 429, body: { error: { code: "rate_limited", message: "slow" } }, headers: { "retry-after": "7" } } : { body: stats }) }).f as any,
      sleep: async (ms) => void waits.push(ms),
    });
    expect((await c.stats()).config.launchLabEnabled).toBe(true);
    expect(waits).toEqual([7000]);
  });

  test("v2 paging stops only at nextCursor null", async () => {
    const recent = fixture("stonk/v2-recent.json");
    let n = 0;
    const c = client({ "GET /api/v2/launches/recent": () => ({ body: { ...recent, page: { ...recent.page, nextCursor: ++n < 3 ? `c${n}` : null } } }) });
    const pages = [];
    for await (const p of c.v2Pages("/launches/recent", { limit: 2 })) pages.push(p);
    expect(pages).toHaveLength(3);
  });

  test("v2 is refused from a browser", async () => {
    const g = globalThis as any;
    g.window = {}; g.document = {};
    try {
      await expect(client({}).recentLaunches()).rejects.toThrow(/no CORS/);
    } finally {
      delete g.window; delete g.document;
    }
  });

  test("v1 error envelope surfaces code", async () => {
    await expect(client({ "GET /api/public/v1/tokens/": () => ({ status: 404, body: fixture("stonk/token.json") }) }).token("x")).rejects.toThrow(/not_found/);
  });
});

describe("claim", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const w = creator.toBase58();
  test("reward coin fixture: nothing claimable, no prepare call", async () => {
    const m = mockFetch({ "GET /api/public/v1/tokens/": () => ({ body: fixture("stonk/fees.json") }) });
    const r = await planClaim(new StonkClient({ fetch: m.f as any }), mint, w);
    expect(r.status).toBe("skipped");
    expect(m.calls.some((c) => c.method === "POST")).toBe(false);
  });

  const claimable = { data: { mint, claimable: { quote: "5" }, scope: "creator-quote-vault", quoteMint: "Q1" }, meta: {} };
  test("prepare sends {creatorWallet}; creator-quote-vault claimed once per quote", async () => {
    const m = mockFetch({
      "GET /api/public/v1/tokens/": () => ({ body: claimable }),
      "POST /api/public/v1/tokens/": () => ({ body: { data: { transaction: "AAAA", intentId: "i1" }, meta: {} } }),
    });
    const c = new StonkClient({ fetch: m.f as any });
    const seen = new Set<string>();
    const a = await planClaim(c, mint, w, seen);
    const b = await planClaim(c, "OtherMint1111111111111111111111111111111111", w, seen);
    expect(a.status).toBe("ready");
    expect(b.status).toBe("skipped");
    expect(m.calls.filter((x) => x.method === "POST").map((x) => x.body)).toEqual([{ creatorWallet: w }]);
  });

  test("403 and 409 are skips", async () => {
    for (const status of [403, 409]) {
      const m = mockFetch({
        "GET /api/public/v1/tokens/": () => ({ body: { data: { claimable: { quote: "1" } }, meta: {} } }),
        "POST /api/public/v1/tokens/": () => ({ status, body: { error: { code: status === 403 ? "forbidden" : "conflict", message: "x" } } }),
      });
      expect((await planClaim(new StonkClient({ fetch: m.f as any }), mint, w)).status).toBe("skipped");
    }
  });

  test("submit is idempotent: alreadySubmitted surfaces", async () => {
    const m = mockFetch({ "POST /api/public/v1/tokens/": () => ({ body: { data: { signature: "sig1", alreadySubmitted: true }, meta: {} } }) });
    const r = await submitSignedClaim(new StonkClient({ fetch: m.f as any }), mint, { creatorWallet: w, intentId: "i1", signedTransaction: "AAAA" });
    expect(r).toEqual({ signature: "sig1", alreadySubmitted: true });
    expect(m.calls[0]!.body).toEqual({ creatorWallet: w, intentId: "i1", signedTransaction: "AAAA" });
  });
});

test("trade input validation", () => {
  expect(() => checkTradeInput({ amountRaw: "1.5", slippageBps: 100, side: "buy" })).toThrow();
  expect(() => checkTradeInput({ amountRaw: "100", slippageBps: 0, side: "buy" })).toThrow();
  expect(() => checkTradeInput({ amountRaw: "100", slippageBps: 100, side: "sell" })).not.toThrow();
  void PublicKey;
});
