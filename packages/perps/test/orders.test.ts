import { describe, expect, it } from "vitest";
import {
  buildGridPlan,
  buildImperialPlaceOrder,
  buildTakeProfitStopLossPlan,
  buildTouchOrder,
  buildTwammOrder,
} from "../src/orders";
import { PerpsValidationError } from "../src/errors";

describe("buildImperialPlaceOrder", () => {
  it("carries the limit price in slPrice (the venue's real semantic) and marks market orders slPrice 0", () => {
    const limit = buildImperialPlaceOrder({
      pairId: "SOL-PERP",
      side: "bid",
      sizeInBaseLots: 10,
      limitPriceUsd: 150,
    });
    expect(limit.orderType).toBe("limit");
    expect(limit.slPrice).toBe(150);
    expect(limit.warnings.join(" ")).toMatch(/rejects price-only orders/);
    const market = buildImperialPlaceOrder({ pairId: "SOL-PERP", side: "ask", sizeInBaseLots: 5 });
    expect(market.orderType).toBe("market");
    expect(market.slPrice).toBe(0);
  });

  it("flags negative size as reduce/close and rejects zero size", () => {
    const close = buildImperialPlaceOrder({ pairId: "SOL-PERP", side: "ask", sizeInBaseLots: -10 });
    expect(close.warnings.join(" ")).toMatch(/reduce\/close/);
    expect(() =>
      buildImperialPlaceOrder({ pairId: "SOL-PERP", side: "bid", sizeInBaseLots: 0 }),
    ).toThrow(PerpsValidationError);
  });
});

describe("buildTakeProfitStopLossPlan", () => {
  it("attaches TP/SL AFTER fill on the exit side — never as conditional flags", () => {
    const plan = buildTakeProfitStopLossPlan({
      positionSide: "long",
      takeProfitPriceUsd: 180,
      stopLossPriceUsd: 140,
    });
    expect(plan.attachAfterFill.takeProfit).toEqual({ side: "ask", limitPriceUsd: 180 });
    expect(plan.attachAfterFill.stopLoss).toEqual({ side: "ask", limitPriceUsd: 140 });
    expect(plan.warnings.join(" ")).toMatch(/empty orderFlags/);
    const short = buildTakeProfitStopLossPlan({ positionSide: "short", stopLossPriceUsd: 160 });
    expect(short.attachAfterFill.stopLoss?.side).toBe("bid");
  });
});

describe("buildTwammOrder", () => {
  it("builds a block-segmented distribution (placeTwammOrder shape), descriptor-level only", () => {
    const d = buildTwammOrder({
      marketId: 3,
      side: "bid",
      totalSize: 100,
      durationBlocks: 1000,
      intervalBlocks: 100,
    });
    expect(d.kind).toBe("imperialTwammOrder");
    expect(d.totalSize).toBe(100);
    expect(d.durationBlocks).toBe(1000);
    expect(d.intervalBlocks).toBe(100);
    expect(d.warnings.join(" ")).toMatch(/not a recurring order/);
    expect(d.warnings.join(" ")).toMatch(/placeTwammOrder/);
  });

  it("rejects a seconds-shaped duration — TWAMM counts blocks", () => {
    expect(() =>
      buildTwammOrder({ marketId: 3, side: "bid", totalSize: 10, durationBlocks: 0 }),
    ).toThrow(PerpsValidationError);
  });
});

describe("buildGridPlan", () => {
  it("quotes inner ±(vol+0.5%) and outer ±(vol+(vol+2.5%)) around mid (imperialBot math)", () => {
    const grid = buildGridPlan({ midUsd: 100, volatilityPct: 0.01 });
    expect(grid.innerBandPct).toBeCloseTo(0.015);
    const byBand = Object.fromEntries(grid.levels.map((l) => [`${l.band}-${l.side}`, l.priceUsd]));
    expect(byBand["inner-bid"]).toBeCloseTo(98.5);
    expect(byBand["inner-ask"]).toBeCloseTo(101.5);
    expect(byBand["outer-bid"]).toBeCloseTo(95.5);
    expect(byBand["outer-ask"]).toBeCloseTo(104.5);
  });
});

describe("buildTouchOrder", () => {
  it("builds a probability-priced Touch descriptor marked NOT a live order path", () => {
    const t = buildTouchOrder({ marketId: "SOL-200-EOW", side: "YES", probabilityPrice: 0.35, size: 10 });
    expect(t.probabilityPrice).toBe(0.35);
    expect(t.warnings.join(" ")).toMatch(/NOT A LIVE ORDER PATH/);
  });

  it("rejects prices outside (0, 1) — Touch prices are probabilities", () => {
    expect(() =>
      buildTouchOrder({ marketId: "m", side: "YES", probabilityPrice: 1.2, size: 1 }),
    ).toThrow(/probabilities/);
  });
});
