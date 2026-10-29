// Ported from Solizardking/jev-trader-solana src/regime.ts + src/coingecko.ts (MIT, 8faeade).
// Changes for the kit: no module globals or process.env, fetch and ask are injected,
// and every failure still fails closed (paused). Signals only: nothing here trades.
import { JevError, type AskFn } from "./decision.ts";

export interface CoingeckoSnapshot {
  source: "coingecko";
  priceUsd: number | null; change24hPct: number | null; high24h: number | null; low24h: number | null;
  volume24hUsd: number | null; marketCapUsd: number | null;
  fetchedAt: number; ageMs: number; stale: boolean; ok: boolean;
}

export const COINGECKO_SOL_MARKETS = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=solana&price_change_percentage=24h";
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function unknownSnapshot(): CoingeckoSnapshot {
  return { source: "coingecko", priceUsd: null, change24hPct: null, high24h: null, low24h: null, volume24hUsd: null, marketCapUsd: null, fetchedAt: 0, ageMs: Infinity, stale: true, ok: false };
}

/** One free CoinGecko read for SOL. Never throws: a failure returns the unknown snapshot. */
export async function fetchSolSnapshot(o: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {}): Promise<CoingeckoSnapshot> {
  const f = o.fetch ?? fetch;
  const now = o.now ?? Date.now;
  try {
    const res = await f(COINGECKO_SOL_MARKETS, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
    if (!res.ok) return unknownSnapshot();
    const m = ((await res.json()) as any[])?.[0];
    if (!m) return unknownSnapshot();
    const t = now();
    return { source: "coingecko", priceUsd: num(m.current_price), change24hPct: num(m.price_change_percentage_24h), high24h: num(m.high_24h), low24h: num(m.low_24h), volume24hUsd: num(m.total_volume), marketCapUsd: num(m.market_cap), fetchedAt: t, ageMs: 0, stale: false, ok: true };
  } catch {
    return unknownSnapshot();
  }
}

export interface BookFeatures { mid?: number; spreadBps?: number; imbalance?: number; retBps20?: number; slot?: number }
export type RegimeChoice = "bullish" | "bearish" | "chop" | "unknown";
export interface RegimeGate {
  paused: boolean; reason: string; allowed: { buy: boolean; sell: boolean };
  regime: { choice: RegimeChoice; confidence: number }; momentumYes: number | null;
  volatility: { score: number; confidence: number } | null; jevOk: boolean; jevLatencyMs: number | null;
  coingecko: CoingeckoSnapshot; decidedAt: number;
}

export const REGIME_DEFAULTS = { coingeckoStaleMs: 300_000, volPauseScore: 2.5 };

export const REGIME_QUESTIONS = {
  regime: {
    type: "choice",
    instructions: {
      question: "What regime best describes SOL right now?",
      context: "Spot SOL-USDC on Solana. The agent proposes short-horizon trades and needs to know whether the tape is directionally safe.",
      inputs: "`coingecko.change24hPct` and `coingecko.priceUsd` vs `high24h`/`low24h` show the day's drift and where price sits in its range. `book.imbalance` (-1 all asks .. 1 all bids) and `book.retBps20` show recent book pressure and mid movement. Agreeing signals = trend; disagreeing or flat signals = chop.",
    },
    criteria: {
      bullish: "Upward regime: 24h change positive and price near the day's high, and/or book bids dominate with positive recent returns.",
      bearish: "Downward regime: 24h change negative and price near the day's low, and/or book asks dominate with negative recent returns.",
      chop: "No clear direction: flat or mixed 24h change, price mid-range, balanced book, or conflicting signals.",
    },
  },
  momentum: { type: "noul", instructions: { question: "Will SOL's current directional move continue over roughly the next 30 seconds?", note: "Answer yes with high probability only if the drift is consistent across the 24h move and recent book pressure. Flat or conflicting state should sit near 0.5." } },
  volatility: {
    type: "score",
    instructions: { question: "How volatile is SOL right now?", note: "Judge from the 24h range, the 24h % move, and the book spread/imbalance swings." },
    criteria: [
      "Calm: 24h range under ~3%, small 24h move, tight book spread, no sharp recent returns.",
      "Normal: 24h range ~3-8% or a moderate one-day move with an orderly book.",
      "Elevated: 24h range ~8-15%, or a strong one-day move, or the book spread/pressure swinging.",
      "Extreme: 24h range above ~15%, fast moves, very wide or unstable book — unsafe to trade blind.",
    ],
  },
} as const;

export function buildRegimeState(snap: CoingeckoSnapshot, book: BookFeatures): string {
  return JSON.stringify({
    market: "SOL-USDC",
    coingecko: { priceUsd: snap.priceUsd, change24hPct: snap.change24hPct, high24h: snap.high24h, low24h: snap.low24h, volume24hUsd: snap.volume24hUsd, marketCapUsd: snap.marketCapUsd, dataAgeSec: snap.ok ? Math.round(snap.ageMs / 1000) : null, dataOk: snap.ok },
    book: { mid: book.mid ?? null, spreadBps: book.spreadBps ?? null, imbalance: book.imbalance ?? null, retBps20: book.retBps20 ?? null, slot: book.slot ?? null, available: book.mid != null },
  });
}

function closed(snap: CoingeckoSnapshot, reason: string, jevOk: boolean, now: number): RegimeGate {
  return { paused: true, reason, allowed: { buy: false, sell: false }, regime: { choice: "unknown", confidence: 0 }, momentumYes: null, volatility: null, jevOk, jevLatencyMs: null, coingecko: snap, decidedAt: now };
}

/** Risk gate over market data. Stale data or any Jev failure => paused (fail closed). */
export async function decideRegime(snap: CoingeckoSnapshot, book: BookFeatures, o: { ask?: AskFn; now?: () => number; coingeckoStaleMs?: number; volPauseScore?: number } = {}): Promise<RegimeGate> {
  const now = (o.now ?? Date.now)();
  const staleMs = o.coingeckoStaleMs ?? REGIME_DEFAULTS.coingeckoStaleMs;
  if (!snap.ok || snap.ageMs > staleMs) return closed(snap, !snap.ok ? "coingecko-unavailable" : "coingecko-stale", true, now);
  if (!o.ask) return closed(snap, "jev-unavailable", false, now);
  let answers: Record<string, any>, latencyMs: number;
  try {
    ({ answers, latencyMs } = await o.ask(buildRegimeState(snap, book), REGIME_QUESTIONS as any));
  } catch (e) {
    void (e instanceof JevError);
    return closed(snap, "jev-unavailable", false, now);
  }
  const r = answers.regime ?? {};
  const choice: RegimeChoice = (["bullish", "bearish", "chop"] as const).includes(r.choice) ? r.choice : "unknown";
  const confidence = typeof r.confidence === "number" ? r.confidence : 0;
  const momentumYes = typeof answers.momentum?.noul === "number" ? answers.momentum.noul : null;
  const v = answers.volatility ?? {};
  const volatility = typeof v.score === "number" ? { score: v.score, confidence: typeof v.confidence === "number" ? v.confidence : 0 } : null;
  const gate: RegimeGate = { paused: false, reason: "ok", allowed: { buy: true, sell: true }, regime: { choice, confidence }, momentumYes, volatility, jevOk: true, jevLatencyMs: Math.round(latencyMs), coingecko: snap, decidedAt: now };
  if (volatility && volatility.score >= (o.volPauseScore ?? REGIME_DEFAULTS.volPauseScore)) return { ...gate, paused: true, reason: "volatility-extreme", allowed: { buy: false, sell: false } };
  if (choice === "bearish" && confidence >= 0.9) return { ...gate, allowed: { buy: false, sell: true }, reason: "regime-bearish" };
  if (choice === "bullish" && confidence >= 0.9) return { ...gate, allowed: { buy: true, sell: false }, reason: "regime-bullish" };
  return { ...gate, reason: "review" };
}

/** Drop a proposal the gate forbids. Spot buy/perp long need `allowed.buy`; sell/short need `allowed.sell`. */
export function gateProposal<P extends { side: "buy" | "sell" | "long" | "short" }>(p: P | null, g: RegimeGate): P | null {
  if (!p || g.paused) return null;
  const up = p.side === "buy" || p.side === "long";
  return (up ? g.allowed.buy : g.allowed.sell) ? p : null;
}
