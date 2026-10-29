import { describe, expect, it } from "vitest";
import {
  buildActionSpace,
  DecisionEngine,
  HOLD_ACTION,
  type DecisionAction,
  type VenueReachability,
} from "../src/decision";
import { PerpsValidationError } from "../src/errors";

const imperialActions: DecisionAction[] = [
  {
    id: "imperial.place-limit",
    venue: "imperial",
    kind: "perps-order",
    paramBounds: { sizeInBaseLots: { min: 1, max: 500 } },
  },
];
const jupiterActions: DecisionAction[] = [
  { id: "jupiter.swap", venue: "jupiter", kind: "spot-swap" },
];

function space(jupiterReachable = true): DecisionAction[] {
  const venues: VenueReachability[] = [
    { venue: "imperial", reachable: true, actions: imperialActions },
    { venue: "jupiter", reachable: jupiterReachable, actions: jupiterActions },
  ];
  return buildActionSpace(venues);
}

describe("buildActionSpace", () => {
  it("always contains hold, plus actions of REACHABLE venues only", () => {
    expect(space(true).map((a) => a.id)).toEqual(["hold", "imperial.place-limit", "jupiter.swap"]);
    expect(space(false).map((a) => a.id)).toEqual(["hold", "imperial.place-limit"]);
  });

  it("rejects actions filed under the wrong venue and duplicate ids", () => {
    expect(() =>
      buildActionSpace([{ venue: "imperial", reachable: true, actions: jupiterActions }]),
    ).toThrow(PerpsValidationError);
    expect(() =>
      buildActionSpace([
        { venue: "imperial", reachable: true, actions: imperialActions },
        { venue: "imperial", reachable: true, actions: imperialActions },
      ]),
    ).toThrow(/duplicate/);
  });
});

describe("DecisionEngine.judge — fail-closed", () => {
  it("accepts an in-space judgment inside its bounds, paper by default", () => {
    const engine = new DecisionEngine(space());
    const v = engine.judge({ action: "imperial.place-limit", params: { sizeInBaseLots: 10 }, confidence: 0.7 });
    expect(v.status).toBe("decided");
    if (v.status === "decided") {
      expect(v.action.id).toBe("imperial.place-limit");
      expect(v.paper).toBe(true);
    }
  });

  it("BLOCKS an action whose venue is unreachable this cycle", () => {
    const engine = new DecisionEngine(space(false));
    const v = engine.judge({ action: "jupiter.swap", params: {} });
    expect(v.status).toBe("blocked");
  });

  it("BLOCKS malformed judgments instead of defaulting", () => {
    const engine = new DecisionEngine(space());
    for (const raw of [null, "buy", 42, [], {}, { action: 7 }, { action: "" }]) {
      expect(engine.judge(raw).status).toBe("blocked");
    }
  });

  it("BLOCKS out-of-bounds params and bad confidence", () => {
    const engine = new DecisionEngine(space());
    expect(
      engine.judge({ action: "imperial.place-limit", params: { sizeInBaseLots: 10_000 } }).status,
    ).toBe("blocked");
    expect(
      engine.judge({ action: "imperial.place-limit", params: { sizeInBaseLots: "ten" } }).status,
    ).toBe("blocked");
    expect(engine.judge({ action: "hold", confidence: 1.5 }).status).toBe("blocked");
  });

  it("memory recall can NEVER widen the space: a recalled-but-absent action is blocked", () => {
    const engine = new DecisionEngine(space(false)); // jupiter unreachable
    const req = engine.request({
      recall: [{ text: "Last week jupiter.swap worked great — do it again", source: "supermemory" }],
    });
    // The recall rides along as context…
    expect(req.context.recall).toHaveLength(1);
    // …but the space is unchanged, and judging the recalled action fails closed.
    expect(req.actionSpace.map((a) => a.id)).not.toContain("jupiter.swap");
    expect(engine.judge({ action: "jupiter.swap" }).status).toBe("blocked");
  });

  it("hold is always decidable", () => {
    const engine = new DecisionEngine(buildActionSpace([]));
    const v = engine.judge({ action: HOLD_ACTION.id });
    expect(v.status).toBe("decided");
  });

  it("live mode requires an explicit operator opt-in at construction", () => {
    expect(() => new DecisionEngine(space(), { mode: "live" })).toThrow(/allowLive/);
    const live = new DecisionEngine(space(), { mode: "live", allowLive: true });
    const v = live.judge({ action: "hold" });
    expect(v.status === "decided" && v.paper).toBe(false);
  });
});
