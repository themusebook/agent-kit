import { PerpsValidationError } from "./errors";

/**
 * The decision-agent pattern, grounded in Solizardking/
 * jev-trader-solana — with the attribution kept precise, because two
 * different designs are easy to conflate:
 *
 * WHAT jev-trader-solana ACTUALLY DOES (file-verified):
 * - A FIXED operation enum (`Operation`: BUY_SPOT | SELL_SPOT |
 *   LONG_PERP | SHORT_PERP | HOLD | PAUSE) — no dynamic action
 *   space. The judgment (TypeSafe System One / JEV, asked via a
 *   subprocess bridge) picks the operation plus ONE slippage target
 *   (s10/s25/s50 → 10/25/50 bps) from five choice heads. Size,
 *   routing and risk are deterministic code, never the model's.
 * - `validateChoice` is the portable contract: the answer's
 *   probability keys must EXACTLY equal the id set, every
 *   probability and the confidence finite in [0,1], the sum within
 *   0.02 of 1, and the choice must be the argmax.
 * - FAIL-CLOSED: any judgment failure returns a typed PAUSE
 *   sentinel (`jevOk: false` + a reason from a small taxonomy:
 *   jev-call-failed / invalid-operation-answer /
 *   invalid-target-answer); a directional answer under the 0.9
 *   confidence threshold is DOWNGRADED to HOLD; venue reachability
 *   and staleness are enforced AFTER the judgment, in deterministic
 *   code (blocked executions carry machine reasons like feeds-stale,
 *   side-blocked, spread-exceeds-slippage, cap-full).
 * - A separate regime judgment (choice bullish/bearish/chop +
 *   momentum probability + 0–3 volatility score over CoinGecko +
 *   book features) gates the cycle: paused regime = no decision
 *   request at all.
 * - NO cross-run memory: state is in-process positions/totals plus
 *   an append-only events journal. Paper is the ONLY implemented
 *   mode — there is no live path and no signing code; a set
 *   PRIVATE_KEY changes only the startup banner.
 *
 * WHAT THIS MODULE ADDS (the kit's generalization, following the
 * pattern jev-trader-solana's README attributes to its companion
 * repo clawd-jev-trading-machine, and the kit brief): an action
 * space BUILT from venue reachability, verdicts named
 * decided/blocked, and memory recall as judge context. Those are
 * kit designs — not claims about jev-trader-solana's internals.
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

/** Market-regime context, mirroring jev-trader-solana's regime gate output (a separate JEV judgment over CoinGecko + book features; a paused regime stops the cycle before any decision request). */
export interface MarketRegime {
  /** The repo's regime choice labels. */
  choice: "bullish" | "bearish" | "chop" | "unknown";
  confidence?: number;
  /** P(move continues ~30s) from the momentum head, when present. */
  momentumYes?: number | null;
  /** Volatility score 0 (calm) – 3 (extreme); the repo pauses at >= 2.5 by default. */
  volatilityScore?: number | null;
  paused?: boolean;
  allowed?: { buy: boolean; sell: boolean };
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
