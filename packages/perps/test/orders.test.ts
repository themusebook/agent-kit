import { describe, expect, it } from "vitest";
import {
  ImperialOrderType,
  ImperialUnderwriter,
  buildImperialBatchPlan,
  buildImperialOrder,
  buildPerpsTradePreview,
  buildTwammAutomationPlan,
} from "../src/orders";
import { PerpsValidationError } from "../src/errors";

const WALLET = "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB";

describe("buildImperialOrder — MobileCreateOrderRequest shape", () => {
  it("defaults: Phoenix underwriter (2), Market (0), 50bps slippage, dryRun true", () => {
    const d = buildImperialOrder({ wallet: WALLET, action: "increase", side: "long", sizeUsd: 80, symbol: "SOL" });
    expect(d.endpoint).toBe("POST /mobile/orders");
    expect(d.dryRun).toBe(true);
    expect(d.request).toMatchObject({
      action: 0,
      side: 0,
      underwriter: ImperialUnderwriter.Phoenix,
      orderType: ImperialOrderType.Market,
      slippageBps: 50,
      profileIndex: 0,
    });
    expect(d.warnings.join(" ")).toMatch(/JWT/);
  });

  it("carries limit triggers at 1e9 oracle scale and REQUIRES a trigger for Limit/StopLimit", () => {
    const d = buildImperialOrder({
      wallet: WALLET,
      action: "increase",
      side: "long",
      sizeUsd: 50,
      orderType: ImperialOrderType.Limit,
      triggerPriceUsd: 150.5,
      triggerCondition: "above",
    });
    expect(d.request.triggerPrice).toBe(150_500_000_000);
    expect(d.request.triggerCondition).toBe(0);
    expect(() =>
      buildImperialOrder({
        wallet: WALLET,
        action: "increase",
        side: "long",
        sizeUsd: 50,
        orderType: ImperialOrderType.StopLimit,
      }),
    ).toThrow(PerpsValidationError);
  });

  it("exposes the exotic order types the repos carry (DCA / Ratchet / LandMine)", () => {
    expect(ImperialOrderType.DCA).toBe(9);
    expect(ImperialOrderType.LandMine).toBe(3);
    expect(ImperialOrderType.FibRatchet).toBe(10);
  });

  it("validates profileIndex 0..5", () => {
    expect(() =>
      buildImperialOrder({ wallet: WALLET, profileIndex: 6, action: "increase", side: "long", sizeUsd: 10 }),
    ).toThrow(/profileIndex/);
  });
});

describe("buildImperialBatchPlan — TP/SL submitted WITH the entry (placeBatch)", () => {
  it("builds TP as Decrease Limit Above and SL as Decrease StopLimit Below for a long", () => {
    const plan = buildImperialBatchPlan({
      entry: { wallet: WALLET, action: "increase", side: "long", sizeUsd: 80, symbol: "SOL" },
      takeProfitPriceUsd: 180,
      stopLossPriceUsd: 140,
    });
    expect(plan.endpoint).toBe("POST /mobile/orders/batch");
    expect(plan.closeOrders).toHaveLength(2);
    const [tp, sl] = plan.closeOrders;
    expect(tp).toMatchObject({ action: 1, orderType: ImperialOrderType.Limit, triggerCondition: 0 });
    expect(tp!.triggerPrice).toBe(180_000_000_000);
    expect(sl).toMatchObject({ action: 1, orderType: ImperialOrderType.StopLimit, triggerCondition: 1 });
  });

  it("inverts the conditions for a short entry", () => {
    const plan = buildImperialBatchPlan({
      entry: { wallet: WALLET, action: "increase", side: "short", sizeUsd: 80 },
      takeProfitPriceUsd: 120,
      stopLossPriceUsd: 160,
    });
    expect(plan.closeOrders[0]).toMatchObject({ triggerCondition: 1 }); // TP below
    expect(plan.closeOrders[1]).toMatchObject({ triggerCondition: 0 }); // SL above
  });
});

describe("buildPerpsTradePreview — the runtime only previews", () => {
  it("routes paper to Vulcan paper-buy/sell and live to rise/order.place with the blocked flag", () => {
    const paper = buildPerpsTradePreview({
      symbol: "SOL", side: "buy", notionalUsd: 50, execution: "paper", preflightOk: true,
    });
    expect(paper.route).toMatchObject({ adapter: "vulcan", action: "paper-buy" });
    const liveBlocked = buildPerpsTradePreview({
      symbol: "SOL", side: "sell", notionalUsd: 50, execution: "live", preflightOk: false,
    });
    expect(liveBlocked.route).toMatchObject({ adapter: "rise", action: "order.place" });
    expect(liveBlocked.route.payload.blocked).toBe(true);
    expect(liveBlocked.warnings.join(" ")).toMatch(/REFUSAL/);
  });
});

describe("buildTwammAutomationPlan — external spot-AMM crank, NOT a perps order", () => {
  it("describes the gated external bridge honestly", () => {
    const plan = buildTwammAutomationPlan({ mode: "crank" });
    expect(plan.externalWorkspace).toMatch(/twamm-master/);
    expect(plan.warnings.join(" ")).toMatch(/not a perps TWAP/);
    expect(plan.warnings.join(" ")).toMatch(/triple-gated/);
  });
});
