import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { fixture, mockFetch } from "./helpers.ts";
import { BackpackPublic, previewOrder, signingString } from "../src/backpack/index.ts";
import { backoffMs, checkSignedForSender, fetchWithRetry, Helius, mcpCallAllowed, redactApiKey, rpcProxyHandler, sendSigned, senderExtras, SENDER_TIP_ACCOUNTS, webhookConfig, MIN_TIP_LAMPORTS, laserstreamConfig } from "../src/helius/index.ts";
import { dflowOrder, jupiterOrder, okxSwap } from "../src/swaps/index.ts";
import { phantomConfig, signingPath } from "../src/phantom/index.ts";
import { allowedCommand, route } from "../src/svm/index.ts";

const noSleep = async () => {};
const OWNER = "86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY"; // docs example owner
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("backpack", () => {
  test("signing string matches the docs single-request example", () => {
    expect(signingString("orderCancel", { symbol: "BTC_USDT", orderId: 28 }, 1614550000000)).toBe(
      "instruction=orderCancel&orderId=28&symbol=BTC_USDT&timestamp=1614550000000&window=5000");
  });
  test("signing string matches the docs batch example", () => {
    const o = (price: string, quantity: string) => ({ symbol: "SOL_USDC_PERP", side: "Bid", orderType: "Limit", price, quantity });
    expect(signingString("orderExecute", [o("141", "12"), o("140", "11")], 1750793021519)).toBe(
      "instruction=orderExecute&orderType=Limit&price=141&quantity=12&side=Bid&symbol=SOL_USDC_PERP&instruction=orderExecute&orderType=Limit&price=140&quantity=11&side=Bid&symbol=SOL_USDC_PERP&timestamp=1750793021519&window=5000");
  });
  test("window over the 60000 max is refused", () => {
    expect(() => signingString("orderCancel", {}, 1, 60001)).toThrow();
  });
  test("order is preview-only with placeholder key and signature", () => {
    const p = previewOrder({ symbol: "SOL_USDC", side: "Bid", orderType: "Limit", price: "141", quantity: "12" }, 1750793021519);
    expect(p.status).toBe("preview");
    expect(p.signingString).toBe("instruction=orderExecute&orderType=Limit&price=141&quantity=12&side=Bid&symbol=SOL_USDC&timestamp=1750793021519&window=5000");
    expect(p.headers["X-Signature"]).toContain("<");
    expect(() => previewOrder({ symbol: "SOL_USDC", side: "Bid", orderType: "Limit", quantity: "1" })).toThrow(/price/);
  });
  test("public reads hit the documented paths and need no key", async () => {
    const spec = fixture("backpack/openapi-subset.json");
    for (const p of ["/api/v1/markets", "/api/v1/depth", "/api/v1/ticker", "/api/v1/klines", "/api/v1/trades"]) expect(spec.paths[p]).toBeDefined();
    const { f, calls } = mockFetch({ "GET /api/v1/depth": () => ({ body: { asks: [["141.1", "2"]], bids: [["140.9", "3"]], lastUpdateId: "1", timestamp: 1 } }) });
    const d: any = await new BackpackPublic({ fetch: f }).depth("SOL_USDC", 5);
    expect(d.bids[0][0]).toBe("140.9");
    expect(calls[0]!.url).toBe("https://api.backpack.exchange/api/v1/depth?symbol=SOL_USDC&limit=5");
    await expect(new BackpackPublic({ fetch: f }).depth("SOL_USDC", 2)).rejects.toThrow(/5, 10, 20/);
    expect(JSON.stringify(calls[0]!.headers)).not.toMatch(/X-API-Key|X-Signature/i);
  });
});

describe("helius client", () => {
  test("key comes from env and is redacted from errors", async () => {
    expect(() => new Helius({ env: {} })).toThrow(/HELIUS_API_KEY/);
    const { f } = mockFetch({ "POST /": () => ({ status: 400, body: { error: "bad" } }) });
    const h = new Helius({ env: { HELIUS_API_KEY: "sekret123" }, fetch: f, sleep: noSleep });
    const e = await h.rpc("getSlot", []).catch((x) => x);
    expect(e.message).not.toContain("sekret123");
    expect(e.message).toContain("api-key=[REDACTED]");
    expect(redactApiKey("https://x/?api-key=abc&b=1")).toBe("https://x/?api-key=[REDACTED]&b=1");
  });
  test("429 waits Retry-After, 5xx backs off, then succeeds", async () => {
    let n = 0;
    const waits: number[] = [];
    const f = async () => (++n === 1 ? new Response("", { status: 429, headers: { "retry-after": "2" } }) : n === 2 ? new Response("", { status: 503 }) : new Response(JSON.stringify({ result: 7 })));
    const r = await fetchWithRetry("https://mainnet.helius-rpc.com/?api-key=k", {}, { fetch: f as any, sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
    expect(r.status).toBe(200);
    expect(waits).toEqual([2000, 2000]);
    expect(backoffMs(10, () => 0.5)).toBe(30000);
    expect(backoffMs(0, () => 0)).toBe(750);
  });
  test("getAssetsByOwner asks for fungibles and native balance (docs owner)", async () => {
    const { f, calls } = mockFetch({ "POST /": () => ({ body: { result: { total: 1, items: [{ id: USDC, interface: "FungibleToken" }], nativeBalance: { lamports: 1 } } } }) });
    const r: any = await new Helius({ apiKey: "k", fetch: f }).assetsByOwner(OWNER);
    expect(calls[0]!.body.method).toBe("getAssetsByOwner");
    expect(calls[0]!.body.params).toMatchObject({ ownerAddress: OWNER, options: { showFungible: true, showNativeBalance: true } });
    expect(r.items[0].interface).toBe("FungibleToken");
  });
  test("getTransactionsForAddress and getPriorityFeeEstimate params follow the docs", async () => {
    const { f, calls } = mockFetch({ "POST /": () => ({ body: { result: { priorityFeeEstimate: 120000 } } }) });
    const h = new Helius({ apiKey: "k", fetch: f });
    await h.transactionsForAddress(OWNER, { limit: 50, filters: { status: "succeeded" } });
    expect(calls[0]!.body.params).toEqual([OWNER, { transactionDetails: "signatures", sortOrder: "desc", limit: 50, filters: { status: "succeeded" } }]);
    await expect(h.transactionsForAddress(OWNER, { limit: 1001 })).rejects.toThrow();
    const fee = await h.priorityFee({ accountKeys: [OWNER], priorityLevel: "High" });
    expect(calls[1]!.body.params).toEqual([{ accountKeys: [OWNER], options: { priorityLevel: "High" } }]);
    expect(fee.priorityFeeEstimate).toBe(120000);
  });
  test("wallet API uses /v1/wallet/{w}/balances", async () => {
    const { f, calls } = mockFetch({ "GET /v1/wallet/": () => ({ body: { balances: [] } }) });
    await new Helius({ apiKey: "k", fetch: f }).walletBalances(OWNER);
    expect(new URL(calls[0]!.url).pathname).toBe(`/v1/wallet/${OWNER}/balances`);
  });
  test("RPC proxy only forwards read methods and never returns the key", async () => {
    const h = { rpc: async (m: string) => { if (m === "getSlot") return 5; throw new Error("boom ?api-key=zzz"); } };
    const handle = rpcProxyHandler(h as any);
    const call = (method: string) => handle(new Request("http://x/api/rpc", { method: "POST", body: JSON.stringify({ id: 1, method, params: [] }) }));
    expect((await (await call("getSlot")).json()).result).toBe(5);
    expect((await call("sendTransaction")).status).toBe(403);
    expect(await (await call("getBalance")).text()).not.toContain("zzz");
  });
  test("webhook, laserstream and MCP allowlist", () => {
    expect(webhookConfig({ webhookURL: "https://me.example/hook", accountAddresses: [OWNER] }).webhookType).toBe("enhanced");
    expect(() => webhookConfig({ webhookURL: "http://x", accountAddresses: [OWNER] })).toThrow();
    expect(JSON.stringify(laserstreamConfig({ accountInclude: [OWNER], env: { HELIUS_API_KEY: "s3" } }))).not.toContain("s3");
    expect(mcpCallAllowed("heliusAsset", "getAssetsByOwner")).toBe(true);
    expect(mcpCallAllowed("heliusWrite", "transferSol")).toBe(false);
    expect(mcpCallAllowed("heliusAccount", "signup")).toBe(false);
    expect(mcpCallAllowed("heliusAccount", "generateKeypair")).toBe(false);
    expect(mcpCallAllowed("heliusStreaming", "createWebhook")).toBe(false);
    expect(mcpCallAllowed("heliusStreaming", "getAllWebhooks")).toBe(true);
  });
});

describe("helius sender", () => {
  const user = Keypair.generate(); // test-only signer standing in for the user's wallet
  const build = (tip: number, sign: boolean) => {
    const ex = senderExtras({ payer: user.publicKey, priorityFeeMicroLamports: 1234, tipLamports: tip < MIN_TIP_LAMPORTS.max ? MIN_TIP_LAMPORTS.max : tip, random: () => 0 });
    const ixs = tip ? [...ex.prepend, SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: user.publicKey, lamports: 1 }), ...ex.append] : [...ex.prepend];
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: user.publicKey, recentBlockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", instructions: ixs }).compileToV0Message());
    if (sign) tx.sign([user]);
    return Buffer.from(tx.serialize()).toString("base64");
  };
  test("extras: fee from estimate, tip last to a Sender tip account, minimum enforced", () => {
    const ex = senderExtras({ payer: user.publicKey, priorityFeeMicroLamports: 10, random: () => 0 });
    expect(ex.append[0]!.keys[1]!.pubkey.toBase58()).toBe(SENDER_TIP_ACCOUNTS[0]!);
    expect(() => senderExtras({ payer: user.publicKey, priorityFeeMicroLamports: 10, tipLamports: 10 })).toThrow();
  });
  test("refuses unsigned or untipped txs", () => {
    expect(() => checkSignedForSender(build(MIN_TIP_LAMPORTS.max, false))).toThrow(/not fully signed/);
    expect(() => checkSignedForSender(build(0, true))).toThrow(/tip/);
    expect(checkSignedForSender(build(MIN_TIP_LAMPORTS.max, true))).toBeTruthy();
  });
  test("posts once with skipPreflight true and maxRetries 0", async () => {
    const { f, calls } = mockFetch({ "POST /fast": () => ({ body: { result: "sig111" } }) });
    expect(await sendSigned(build(MIN_TIP_LAMPORTS.max, true), { fetch: f })).toBe("sig111");
    expect(calls[0]!.url).toBe("https://sender.helius-rpc.com/fast");
    expect(calls[0]!.body.params[1]).toEqual({ encoding: "base64", skipPreflight: true, maxRetries: 0 });
  });
});

describe("swaps return unsigned txs", () => {
  test("jupiter /swap/v2/order with taker and x-api-key", async () => {
    const { f, calls } = mockFetch({ "GET /swap/v2/order": () => ({ body: { transaction: "AQID", requestId: "r1", inAmount: "1000000", outAmount: "150000", router: "iris", mode: "ultra", feeBps: 5 } }) });
    const s = await jupiterOrder({ inputMint: SOL, outputMint: USDC, amount: 1000000, taker: OWNER, slippageBps: 50 }, { fetch: f, apiKey: "jk" });
    expect(s).toMatchObject({ kind: "unsigned-swap", venue: "jupiter", transaction: "AQID", meta: { requestId: "r1" } });
    expect(new URL(calls[0]!.url).searchParams.get("taker")).toBe(OWNER);
    expect(calls[0]!.headers["x-api-key"]).toBe("jk");
  });
  test("jupiter without a transaction is an error", async () => {
    const { f } = mockFetch({ "GET /swap/v2/order": () => ({ body: { transaction: null, errorMessage: "Insufficient funds" } }) });
    await expect(jupiterOrder({ inputMint: SOL, outputMint: USDC, amount: 1, taker: OWNER }, { fetch: f, env: {} })).rejects.toThrow(/Insufficient/);
  });
  test("dflow /order on the dev endpoint with userPublicKey", async () => {
    const { f, calls } = mockFetch({ "GET /order": () => ({ body: { transaction: "AQID", inAmount: "1", outAmount: "2", executionMode: "sync" } }) });
    const s = await dflowOrder({ inputMint: SOL, outputMint: USDC, amount: "1000000", taker: OWNER }, { fetch: f, env: {} });
    const u = new URL(calls[0]!.url);
    expect(u.origin).toBe("https://dev-quote-api.dflow.net");
    expect(u.searchParams.get("userPublicKey")).toBe(OWNER);
    expect(u.searchParams.get("slippageBps")).toBe("auto");
    expect(s.meta.executionMode).toBe("sync");
  });
  test("okx refuses honeypots and high impact, returns tx.data otherwise", async () => {
    const exec = (quote: unknown) => async (_c: string, a: string[]) => ({ code: 0, stderr: "", stdout: JSON.stringify(a[1] === "quote" ? quote : { tx: { data: "AQID" } }) });
    const base = { from: SOL, to: USDC, amount: "1000000", wallet: OWNER };
    await expect(okxSwap(base, { exec: exec({ fromToken: {}, toToken: { isHoneyPot: true } }) })).rejects.toThrow(/honeypot/);
    await expect(okxSwap(base, { exec: exec({ priceImpactPercent: "12" }) })).rejects.toThrow(/price impact/);
    expect((await okxSwap(base, { exec: exec({ priceImpactPercent: "0.1" }) })).transaction).toBe("AQID");
    await expect(okxSwap(base, { exec: async () => ({ code: 127, stdout: "", stderr: "" }) })).rejects.toThrow(/install it yourself/i);
  });
});

describe("phantom and svm", () => {
  test("phantom config rules", () => {
    expect(phantomConfig()).toEqual({ providers: ["injected"], addressTypes: ["solana"] });
    expect(() => phantomConfig({ providers: ["google"] })).toThrow(/appId/);
    expect(signingPath("google")).toBe("signAndSendTransaction");
    expect(signingPath("injected")).toBe("signTransaction+sender");
  });
  test("svm routes to solana-dev references and refuses deploys", () => {
    expect(route("LiteSVM test failing").map((r) => r.topic)).toContain("testing");
    expect(route("server-side signing with keychain")[0]).toMatchObject({ topic: "keychain", docsOnly: true });
    expect(allowedCommand("anchor build")).toBe(true);
    expect(allowedCommand("solana program deploy target/deploy/x.so")).toBe(false);
  });
});
