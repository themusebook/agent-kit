import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { decideQuote, OPERATION_IDS, proposeTrade, type DecisionStateInput } from "../src/decision/index.ts";
import { ImperialVenue, PhoenixVenue, checkIntent, kitToWeb3 } from "../src/perps/index.ts";
import { assertNoSecrets, buildUnsignedTx, decodeUnsignedTx, ephemeralMintKeypair, networkFromEnv } from "../src/unsigned.ts";
import { parseArgs } from "../src/cli.ts";
import { mockFetch } from "./helpers.ts";

const v = { bid: 100, ask: 100.1, mid: 100.05, spreadBps: 10, ageSec: 1, ok: true };
const state: DecisionStateInput = {
  spot: { jupiter: v, dflow: v, bestBid: 100, bestAsk: 100.1, bestMid: 100.05, bestSpreadBps: 10, bestBidVenue: "jupiter", bestAskVenue: "dflow", refPriceUsd: 100 },
  perps: { mark: 100, bid: 99.9, ask: 100.1, mid: 100, spreadBps: 20, fundingPerHourPct: 0.001, openInterestUsd: 1e6, basis: -0.05, ageSec: 1, ok: true },
  position: { spotSol: 0, spotEntry: null, spotUnrealizedUsd: 0, perpSol: 0, perpEntry: null, perpUnrealizedUsd: 0, perpFundingPaidUsd: 0, maxPositionSol: 1, maxPerpSol: 1 },
  risk: { tradeSizeSol: 0.1, perpSizeSol: 0.1, maxPositionSol: 1, maxPerpSol: 1, allowedSpotBuy: true, allowedSpotSell: true, allowedPerpLong: true, allowedPerpShort: true },
  regime: null,
  recent: { retBps20: 0, mids: [] },
};
const head = (ids: readonly string[], choice: string, p: number) => ({ choice, confidence: p, probabilities: Object.fromEntries(ids.map((i) => [i, i === choice ? p : (1 - p) / (ids.length - 1)])) });

describe("decision agent", () => {
  test("no model configured: fails closed to PAUSE, no proposal", async () => {
    const d = await decideQuote(state);
    expect(d.operation).toBe("PAUSE");
    expect(d.jevOk).toBe(false);
    expect(proposeTrade(d, { spot: "0.1", perp: "0.1" })).toBeNull();
  });
  test("confident LONG_PERP becomes a proposal that still needs the user's signature", async () => {
    const d = await decideQuote(state, { ask: async () => ({ latencyMs: 1, answers: { operation: head(OPERATION_IDS, "LONG_PERP", 0.95), long_perp_target: head(["s10", "s25", "s50"], "s25", 0.8) } }) });
    const p = proposeTrade(d, { spot: "0.1", perp: "0.2" }, 0)!;
    expect(p).toMatchObject({ kind: "perp", side: "long", slippageBps: 25, size: "0.2", requiresUserSignature: true });
  });
  test("low confidence downgrades to HOLD", async () => {
    const d = await decideQuote(state, { ask: async () => ({ latencyMs: 1, answers: { operation: head(OPERATION_IDS, "BUY_SPOT", 0.6) } }) });
    expect(d.operation).toBe("HOLD");
    expect(proposeTrade(d, { spot: "1", perp: "1" })).toBeNull();
  });
  test("malformed answer fails closed", async () => {
    const d = await decideQuote(state, { ask: async () => ({ latencyMs: 1, answers: { operation: { choice: "BUY_SPOT" } } }) });
    expect(d.reason).toBe("invalid-operation-answer");
  });
});

describe("perps venues", () => {
  test("kit instruction roles map to web3 signer/writable flags", () => {
    const a = Keypair.generate().publicKey.toBase58();
    const ix = kitToWeb3({ programAddress: a, accounts: [0, 1, 2, 3].map((role) => ({ address: a, role })), data: new Uint8Array([1, 2]) });
    expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual([[false, false], [false, true], [true, false], [true, true]]);
    expect([...ix.data]).toEqual([1, 2]);
  });
  test("intent guards", () => {
    const ok = { venue: "phoenix" as const, symbol: "SOL", side: "long" as const, baseUnits: "0.1", priceLimitUsd: 150, authority: "x" };
    expect(() => checkIntent(ok)).not.toThrow();
    expect(() => checkIntent({ ...ok, priceLimitUsd: 0 })).toThrow(/priceLimitUsd/);
    expect(() => checkIntent({ ...ok, baseUnits: "-1" })).toThrow();
  });
  test("phoenix order: Rise ixs wrapped in an unsigned tx", async () => {
    const authority = Keypair.generate().publicKey.toBase58();
    const prog = Keypair.generate().publicKey.toBase58();
    const seen: any[] = [];
    const client: any = {
      orderPackets: { buildMarketOrderPacket: async (a: any) => (seen.push(a), { packet: 1 }) },
      ixs: { buildPlaceMarketOrder: async (a: any) => (seen.push(a), { programAddress: prog, accounts: [{ address: authority, role: 3 }], data: new Uint8Array([9]) }) },
      api: { markets: () => ({ getMarkets: async () => [] }) },
    };
    const r = await new PhoenixVenue({ network: "devnet", client }).buildOrder({ venue: "phoenix", symbol: "SOL-PERP", side: "short", baseUnits: "0.5", priceLimitUsd: 90, authority }, { recentBlockhash: "11111111111111111111111111111111" });
    expect(r.status).toBe("unsigned");
    if (r.status !== "unsigned") return;
    expect(seen[0]).toEqual({ symbol: "SOL", side: 1, baseUnits: "0.5", priceLimitUsd: 90 });
    expect(r.tx.requiredSigners).toEqual([authority]);
    expect(decodeUnsignedTx(r.tx.base64).signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  });
  test("imperial orders are preview-only; reads use documented paths", async () => {
    const m = mockFetch({ "GET /api/v1/positions": () => ({ body: { positions: [] } }) });
    const imp = new ImperialVenue({ network: "mainnet-beta", fetch: m.f as any });
    const r = await imp.buildOrder({ venue: "imperial", symbol: "SOL", side: "long", baseUnits: "1", priceLimitUsd: 200, authority: "w" });
    expect(r.status).toBe("disabled");
    await imp.positions("W1");
    expect(m.calls[0]!.url).toBe("https://api.imperial.space/api/v1/positions?walletAddress=W1");
  });
  test("imperial deposit build-tx is returned unsigned, never sent", async () => {
    const payer = Keypair.generate().publicKey;
    const tx = buildUnsignedTx({ network: "mainnet-beta", feePayer: payer, recentBlockhash: "11111111111111111111111111111111", instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 })], description: "t" });
    const m = mockFetch({ "POST /api/v1/deposit/build-tx": () => ({ body: { transaction: tx.base64 } }) });
    const r = await new ImperialVenue({ network: "mainnet-beta", fetch: m.f as any }).buildDeposit({ wallet: payer.toBase58(), profileIndex: 0, amount: 1_000_000, mode: "deposit" });
    expect(r.base64).toBe(tx.base64);
    expect(m.calls.map((c) => c.method + " " + new URL(c.url).pathname)).toEqual(["POST /api/v1/deposit/build-tx"]);
  });
});

describe("key handling", () => {
  test("assertNoSecrets refuses key material", () => {
    expect(() => assertNoSecrets({ a: { privateKey: "x" } })).toThrow(/never accepts private keys/);
    expect(() => assertNoSecrets({ k: new Uint8Array(64) })).toThrow(/secret key/);
    expect(() => assertNoSecrets(parseArgs(["--secret-key", "x"]).flags)).toThrow();
    expect(() => assertNoSecrets({ wallet: "pubkey" })).not.toThrow();
  });
  test("ephemeral mint signs only its own slot", () => {
    const payer = Keypair.generate().publicKey;
    const mint = ephemeralMintKeypair();
    const tx = buildUnsignedTx({ network: "devnet", feePayer: payer, recentBlockhash: "11111111111111111111111111111111", ephemeralMint: mint, instructions: [SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint.publicKey, lamports: 1, space: 0, programId: SystemProgram.programId })], description: "t" });
    expect(tx.partiallySignedBy).toEqual([mint.publicKey.toBase58()]);
    expect(JSON.stringify(tx)).not.toContain(Buffer.from(mint.secretKey).toString("base64"));
  });
  test("default network is devnet", () => {
    expect(networkFromEnv({})).toBe("devnet");
  });
  test("no source file loads a secret key, reads a keypair file or a .env", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    for (const f of walk(join(import.meta.dir, "..", "src"))) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/fromSecretKey|fromSeed|PRIVATE_KEY|readFileSync|dotenv|["'`]\.env|bs58\.decode/);
    }
  });
});
void PublicKey;
