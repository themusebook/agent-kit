import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPERIAL_RISK,
  DEFAULT_PERPS_RISK_LIMITS,
  buildPreflightReport,
  clampImperialSize,
  resolveTradingMode,
  type PreflightContext,
} from "../src/risk";

const ctx: PreflightContext = {
  limits: DEFAULT_PERPS_RISK_LIMITS,
  mode: "observe",
  rpcUrl: "https://rpc.example",
  wallet: "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB",
};
const req = { symbol: "SOL", notionalUsd: 100, leverage: 2, expectedSpreadBps: 12, execution: "paper" as const };

describe("resolveTradingMode — refuse-by-default arming", () => {
  it("is observe unless LIVE_TRADING + OPERATOR_CONFIRMED + sim-only OFF (simOnly defaults true)", () => {
    expect(resolveTradingMode({})).toBe("observe");
    expect(resolveTradingMode({ liveTrading: true, operatorConfirmed: true })).toBe("observe"); // simOnly still on
    expect(resolveTradingMode({ liveTrading: true, operatorConfirmed: true, simOnly: false })).toBe("live");
    expect(resolveTradingMode({ liveTrading: true, simOnly: false })).toBe("observe"); // no operator confirm
    expect(resolveTradingMode({ paper: true })).toBe("paper");
  });
});

describe("buildPreflightReport — the repos' defaults (250 / 3x / 40bps / allowlist)", () => {
  it("passes a conforming paper request and still warns that signing happens elsewhere", () => {
    const r = buildPreflightReport(ctx, req);
    expect(r.ok).toBe(true);
    expect(r.blocking).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/simulate and sign outside/);
  });

  it("collects ALL blockers: missing rpc, missing wallet, symbol, notional, leverage, spread", () => {
    const r = buildPreflightReport(
      { limits: DEFAULT_PERPS_RISK_LIMITS, mode: "observe", rpcUrl: undefined, wallet: undefined },
      { symbol: "DOGE", notionalUsd: 251, leverage: 4, expectedSpreadBps: 41, execution: "paper" },
    );
    expect(r.ok).toBe(false);
    const b = r.blocking.join("\n");
    expect(b).toMatch(/missing-rpc/);
    expect(b).toMatch(/missing-wallet/);
    expect(b).toMatch(/symbol-not-allowed/);
    expect(b).toMatch(/notional-cap/);
    expect(b).toMatch(/leverage-cap/);
    expect(b).toMatch(/spread-cap/);
    expect(DEFAULT_PERPS_RISK_LIMITS).toEqual({
      allowedSymbols: ["SOL", "ETH", "BTC"],
      maxNotionalUsd: 250,
      maxLeverage: 3,
      maxSpreadBps: 40,
      requireWallet: true,
    });
  });

  it("blocks live execution while mode is not live", () => {
    const r = buildPreflightReport(ctx, { ...req, execution: "rise-live" });
    expect(r.ok).toBe(false);
    expect(r.blocking.join(" ")).toMatch(/live-not-armed/);
    const live = buildPreflightReport({ ...ctx, mode: "live" }, { ...req, execution: "rise-live" });
    expect(live.ok).toBe(true);
  });

  it("rejects a non-positive notional", () => {
    const r = buildPreflightReport(ctx, { ...req, notionalUsd: 0 });
    expect(r.blocking.join(" ")).toMatch(/notional-invalid/);
  });
});

describe("Imperial layer — stricter numbers, CLAMP not block", () => {
  it("carries the Imperial defaults ($100 max, 50bps slippage)", () => {
    expect(DEFAULT_IMPERIAL_RISK).toEqual({
      maxSizeUsd: 100,
      slippageBps: 50,
      allowedSymbols: ["SOL", "ETH", "BTC"],
    });
  });

  it("clamps oversize silently (surfaced, not hidden) and passes conforming sizes through", () => {
    expect(clampImperialSize(250)).toEqual({ sizeUsd: 100, clamped: true });
    expect(clampImperialSize(80)).toEqual({ sizeUsd: 80, clamped: false });
  });
});
