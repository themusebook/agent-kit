import { describe, expect, test } from "bun:test";
import { decideRegime, fetchSolSnapshot, gateProposal, unknownSnapshot, type CoingeckoSnapshot } from "../src/decision/index.ts";

const snap: CoingeckoSnapshot = { ...unknownSnapshot(), priceUsd: 150, change24hPct: -4, high24h: 160, low24h: 148, ok: true, stale: false, ageMs: 1000, fetchedAt: 1 };
const ask = (answers: Record<string, any>) => async () => ({ answers, latencyMs: 12 });
const buy = { side: "buy" as const }, sell = { side: "sell" as const };

describe("jev regime gate (ported)", () => {
  test("fails closed with no ask, stale data, or a Jev error", async () => {
    expect((await decideRegime(snap, {})).reason).toBe("jev-unavailable");
    expect((await decideRegime({ ...snap, ageMs: 10_000_000 }, {}, { ask: ask({}) })).reason).toBe("coingecko-stale");
    expect((await decideRegime(unknownSnapshot(), {}, { ask: ask({}) })).paused).toBe(true);
    const g = await decideRegime(snap, {}, { ask: async () => { throw new Error("x"); } });
    expect(g.paused && !g.jevOk).toBe(true);
  });
  test("confident bearish blocks buys; extreme volatility pauses", async () => {
    const g = await decideRegime(snap, {}, { ask: ask({ regime: { choice: "bearish", confidence: 0.95 }, volatility: { score: 1 } }) });
    expect(g.allowed).toEqual({ buy: false, sell: true });
    expect(gateProposal(buy, g)).toBeNull();
    expect(gateProposal(sell, g)).toEqual(sell);
    const v = await decideRegime(snap, {}, { ask: ask({ regime: { choice: "chop", confidence: 0.5 }, volatility: { score: 3 } }) });
    expect(v.reason).toBe("volatility-extreme");
    expect(gateProposal(sell, v)).toBeNull();
  });
  test("low confidence is review, not a block", async () => {
    const g = await decideRegime(snap, {}, { ask: ask({ regime: { choice: "bullish", confidence: 0.6 } }) });
    expect(g.reason).toBe("review");
    expect(g.allowed).toEqual({ buy: true, sell: true });
  });
  test("snapshot never throws", async () => {
    const bad = (async () => { throw new Error("net"); }) as unknown as typeof fetch;
    expect((await fetchSolSnapshot({ fetch: bad })).ok).toBe(false);
    const good = (async () => new Response(JSON.stringify([{ current_price: 151, high_24h: 160 }]))) as unknown as typeof fetch;
    expect((await fetchSolSnapshot({ fetch: good })).priceUsd).toBe(151);
  });
});
