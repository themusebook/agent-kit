import { PerpsValidationError } from "./errors";

/**
 * The decision-agent pattern, grounded in Solizardking/
 * jev-trader-solana. That repo has NO single canonical "judgment"
 * type — the pattern is a pipeline of seams, and this module mirrors
 * the seams, not invented names:
 * - `decision.ts` builds the action space DYNAMICALLY from the
 *   venues reachable right now: a closed discriminated union
 *   (TradeAction: imperial/jupiter buy/sell with signed amountUsd —
 *   sells are NEGATIVE — plus basket legs carrying poolId + weight
 *   in (0,1], Σ weights ≤ 1), populated each tick from LIVE venue
 *   state (ImperialState / JupiterState / DflowState / PumpState /
 *   StonkState). A venue whose state reads null/empty contributes
 *   no executable options. This module generalizes that as
 *   buildActionSpace(reachability) — the semantics (space from live
 *   reachability only) are the repo's; the reachability record is
 *   the kit's abstraction of its per-venue state reads.
 * - `book.ts` is a numbers-only guardrail over the model's text (the
 *   model can emit plausible-but-wrong numbers; the book recomputes).
 * - `jev.ts` is a single-shot approve/objection gate over a
 *   STRUCTURED proposal (TradeDecision-shaped), FAIL-CLOSED: an
 *   unparseable answer is an objection, never an approval.
 * - `trader.ts` runs the loop PAPER-ONLY and hard-refuses live mode.
 *
 * The invariants (the whole point of the pattern):
 * - FAIL-CLOSED: a malformed judgment, an action outside the space,
 *   or a parameter outside its declared bounds resolves to BLOCKED —
 *   never to a default action, never to a guess.
 * - The action space is built ONLY from reachable venues. Memory
 *   recall may INFORM a judgment (it rides along as context) but can
 *   never widen the space: a recalled action that is not in the
 *   space is blocked like any other out-of-space answer.
 * - PAPER BY DEFAULT: the engine produces decision PLANS. Live mode
 *   requires an explicit operator opt-in at construction, and even
 *   then the engine never executes — execution stays with the caller
 *   behind their own risk gates (see risk.ts).
 */

export interface DecisionAction {
  /** Stable id the judgment must name exactly, e.g. "imperial.place-limit". */
  id: string;
  /** The venue that must be reachable for this action to exist. */
  venue: string;
  kind: string;
  /** Numeric parameter bounds, enforced at validation time when declared. */
  paramBounds?: Record<string, { min?: number; max?: number }>;
  description?: string;
}

export interface VenueReachability {
  venue: string;
  reachable: boolean;
  actions: DecisionAction[];
}

/** The always-available action: doing nothing is always in space. */
export const HOLD_ACTION: DecisionAction = {
  id: "hold",
  venue: "none",
  kind: "no-op",
  description: "Take no action this cycle.",
};

/**
 * Build the action space from reachable venues ONLY. Unreachable
 * venues contribute nothing — their actions do not exist for this
 * decision, however attractive or well-remembered they are.
 */
export function buildActionSpace(venues: VenueReachability[]): DecisionAction[] {
  const space: DecisionAction[] = [HOLD_ACTION];
  const seen = new Set<string>([HOLD_ACTION.id]);
  for (const v of venues) {
    if (!v.reachable) continue;
    for (const a of v.actions) {
      if (a.venue !== v.venue) {
        throw new PerpsValidationError(
          "actions",
          `action "${a.id}" declares venue "${a.venue}" but was supplied under venue "${v.venue}"`,
        );
      }
      if (seen.has(a.id)) {
        throw new PerpsValidationError("actions", `duplicate action id in space: "${a.id}"`);
      }
      seen.add(a.id);
      space.push(a);
    }
  }
  return space;
}

/** Market-regime context (the jev stack classifies regime from CoinGecko data — as NARRATIVE for the judge, never as a sizing input). */
export interface MarketRegime {
  /** The repo's classifyRegime labels. */
  label: "calm_uptrend" | "chop" | "panic" | "rebound" | "mania" | "unknown";
  trend?: "up" | "down" | "range" | "unknown";
  volatility?: "low" | "normal" | "high";
  source?: string;
}

/** A recalled memory note: CONTEXT for the judgment, never a source of actions. */
export interface MemoryNote {
  text: string;
  at?: string;
  source?: string;
}

export interface DecisionContext {
  regime?: MarketRegime;
  /** Recalled notes — information only; they cannot add actions to the space. */
  recall?: MemoryNote[];
  [key: string]: unknown;
}

/** What a judgment engine (TypeSafe/JEV model or any typed judge) is asked. */
export interface DecisionRequest {
  actionSpace: DecisionAction[];
  context: DecisionContext;
}

/** The raw judgment shape the engine must answer in. Anything else is malformed → BLOCKED. */
export interface RawJudgment {
  action: string;
  params?: Record<string, unknown>;
  confidence?: number;
  rationale?: string;
}

export type DecisionVerdict =
  | {
      status: "decided";
      action: DecisionAction;
      params: Record<string, unknown>;
      confidence?: number;
      rationale?: string;
      /** Always true unless the operator explicitly opted into live at construction. */
      paper: boolean;
    }
  | { status: "blocked"; reason: string };

export interface DecisionEngineConfig {
  /**
   * "paper" (default): decisions are plans, nothing executes.
   * "live": only with allowLive — and the engine STILL only returns
   * verdicts; the caller executes behind their own gates.
   */
  mode?: "paper" | "live";
  /** Required to construct a live-mode engine. Deliberate, explicit, operator-only. */
  allowLive?: boolean;
}

export class DecisionEngine {
  readonly paper: boolean;
  private readonly actionSpace: DecisionAction[];
  private readonly byId: Map<string, DecisionAction>;

  constructor(actionSpace: DecisionAction[], config: DecisionEngineConfig = {}) {
    const mode = config.mode ?? "paper";
    if (mode === "live" && config.allowLive !== true) {
      throw new PerpsValidationError(
        "mode",
        "live mode requires an explicit operator opt-in (allowLive: true) — the decision engine is paper by default and fails closed",
      );
    }
    this.paper = mode === "paper";
    this.actionSpace = actionSpace;
    this.byId = new Map(actionSpace.map((a) => [a.id, a]));
  }

  /** The request to hand a judgment engine: the space + context (recall rides as context only). */
  request(context: DecisionContext = {}): DecisionRequest {
    return { actionSpace: this.actionSpace, context };
  }

  /**
   * Validate a raw judgment against the space. FAIL-CLOSED: anything
   * malformed, out-of-space or out-of-bounds is BLOCKED with a
   * reason — never coerced, never defaulted.
   */
  judge(raw: unknown): DecisionVerdict {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { status: "blocked", reason: "judgment is not an object — fail-closed" };
    }
    const j = raw as Partial<RawJudgment>;
    if (typeof j.action !== "string" || j.action.length === 0) {
      return { status: "blocked", reason: "judgment names no action — fail-closed" };
    }
    const action = this.byId.get(j.action);
    if (!action) {
      return {
        status: "blocked",
        reason: `action "${j.action}" is not in the current action space (its venue may be unreachable, or it came from memory — recall informs, it never widens the space)`,
      };
    }
    const params = (j.params ?? {}) as Record<string, unknown>;
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return { status: "blocked", reason: "judgment params are not an object — fail-closed" };
    }
    if (action.paramBounds) {
      for (const [key, bounds] of Object.entries(action.paramBounds)) {
        const v = params[key];
        if (v === undefined) continue;
        if (typeof v !== "number" || !Number.isFinite(v)) {
          return { status: "blocked", reason: `param "${key}" must be a finite number — fail-closed` };
        }
        if (bounds.min !== undefined && v < bounds.min) {
          return { status: "blocked", reason: `param "${key}"=${v} is below its declared minimum ${bounds.min}` };
        }
        if (bounds.max !== undefined && v > bounds.max) {
          return { status: "blocked", reason: `param "${key}"=${v} exceeds its declared maximum ${bounds.max}` };
        }
      }
    }
    if (j.confidence !== undefined && (typeof j.confidence !== "number" || j.confidence < 0 || j.confidence > 1)) {
      return { status: "blocked", reason: "confidence must be a number in [0, 1] — fail-closed" };
    }
    return {
      status: "decided",
      action,
      params,
      ...(j.confidence !== undefined ? { confidence: j.confidence } : {}),
      ...(typeof j.rationale === "string" ? { rationale: j.rationale } : {}),
      paper: this.paper,
    };
  }
}
