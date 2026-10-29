import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERPS_RISK_POLICY,
  evaluatePreTradeRisk,
  sizePerpsOrder,
  type PerpsRiskPolicy,
} from "../src/risk";
import { RiskCheckError } from "../src/errors";

const policy: PerpsRiskPolicy = { ...DEFAULT_PERPS_RISK_POLICY };
const base = {
  policy,
  bookNonEmpty: true,
  notionalUsd: 100,
  leverage: 2,
  currentExposureUsd: 0,
};

describe("evaluatePreTradeRisk (source-repo thresholds)", () => {
  it("passes a conforming order and reports the dry-run posture", () => {
    expect(evaluatePreTradeRisk(base)).toEqual({ ok: true, dryRun: true });
    expect(
      evaluatePreTradeRisk({ ...base, policy: { ...policy, dryRun: false } }).dryRun,
    ).toBe(false);
  });

  it("kill switch refuses everything", () => {
    expect(() =>
      evaluatePreTradeRisk({ ...base, policy: { ...policy, killSwitch: true } }),
    ).toThrow(expect.objectContaining({ name: "RiskCheckError", code: "kill-switch" }));
  });

  it("empty book refuses", () => {
    expect(() => evaluatePreTradeRisk({ ...base, bookNonEmpty: false })).toThrow(
      expect.objectContaining({ code: "empty-market" }),
    );
  });

  it("enforces the source caps: $5 floor, $1000/order, 2x leverage, $5000 exposure", () => {
    expect(() => evaluatePreTradeRisk({ ...base, notionalUsd: 4 })).toThrow(
      expect.objectContaining({ code: "sizing-floor" }),
    );
    expect(() => evaluatePreTradeRisk({ ...base, notionalUsd: 1001 })).toThrow(
      expect.objectContaining({ code: "notional-cap" }),
    );
    expect(() => evaluatePreTradeRisk({ ...base, leverage: 3 })).toThrow(
      expect.objectContaining({ code: "leverage-cap" }),
    );
    expect(() =>
      evaluatePreTradeRisk({ ...base, currentExposureUsd: 4950, notionalUsd: 100 }),
    ).toThrow(expect.objectContaining({ code: "exposure-cap" }));
  });

  it("refusals are RiskCheckError instances", () => {
    expect(() => evaluatePreTradeRisk({ ...base, notionalUsd: 1001 })).toThrow(RiskCheckError);
  });

  it("trips the daily-loss circuit breaker when the policy carries one (bot layer)", () => {
    const withBreaker = { ...policy, maxDailyLossUsd: 100 };
    expect(
      evaluatePreTradeRisk({ ...base, policy: withBreaker, dailyLossUsd: 99 }).ok,
    ).toBe(true);
    expect(() =>
      evaluatePreTradeRisk({ ...base, policy: withBreaker, dailyLossUsd: 100 }),
    ).toThrow(expect.objectContaining({ code: "daily-loss-cap" }));
  });

  it("ships imperialBot's RISK_PRESETS verbatim — including the 5x-vs-2x disagreement", async () => {
    const { PERPS_RISK_PRESETS } = await import("../src/risk");
    expect(PERPS_RISK_PRESETS.balanced).toEqual({
      maxPositionUsd: 200,
      maxDailyLossUsd: 100,
      defaultLeverage: 3,
      stopLossPct: 3,
      takeProfitPct: 6,
    });
    expect(PERPS_RISK_PRESETS.aggressive.defaultLeverage).toBe(5);
    // …while the kit's default policy follows the stricter financial layer.
    expect(policy.maxLeverage).toBe(2);
  });
});

describe("sizePerpsOrder (money.ts semantics)", () => {
  it("sizes equity × pct, capped at the per-order notional cap, floored to lots", () => {
    expect(sizePerpsOrder({ policy, equityUsd: 10_000, pctOfEquity: 0.05, priceUsd: 150 })).toEqual({
      notionalUsd: 500,
      lots: 3,
    });
    // equity × pct above the cap → the cap binds
    expect(sizePerpsOrder({ policy, equityUsd: 100_000, pctOfEquity: 0.5, priceUsd: 100 }).notionalUsd).toBe(1000);
  });

  it("REFUSES a sub-lot size instead of rounding up", () => {
    expect(() =>
      sizePerpsOrder({ policy, equityUsd: 100, pctOfEquity: 0.05, priceUsd: 150 }),
    ).toThrow(expect.objectContaining({ code: "sizing-floor" }));
  });
});
