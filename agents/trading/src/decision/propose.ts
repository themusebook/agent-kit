import type { QuoteDecision } from "./decision.ts";

export interface TradeProposal {
  id: string;
  kind: "spot" | "perp";
  side: "buy" | "sell" | "long" | "short";
  slippageBps: number;
  confidence: number;
  /** Size comes from the caller's fixed config, never from the model. */
  size: string;
  requiresUserSignature: true;
  reason: string;
}

/**
 * Turn a decision into a proposal. A proposal is never executed here: an
 * executor agent turns it into an unsigned tx and the user signs each one.
 */
export function proposeTrade(d: QuoteDecision, sizes: { spot: string; perp: string }, now = Date.now()): TradeProposal | null {
  if (!d.jevOk || d.slippageBps === null) return null;
  const map = {
    BUY_SPOT: ["spot", "buy"],
    SELL_SPOT: ["spot", "sell"],
    LONG_PERP: ["perp", "long"],
    SHORT_PERP: ["perp", "short"],
  } as const;
  const m = (map as any)[d.operation] as readonly ["spot" | "perp", TradeProposal["side"]] | undefined;
  if (!m) return null;
  return {
    id: `${d.operation.toLowerCase()}-${now}`,
    kind: m[0],
    side: m[1],
    slippageBps: d.slippageBps,
    confidence: d.confidence,
    size: m[0] === "spot" ? sizes.spot : sizes.perp,
    requiresUserSignature: true,
    reason: d.reason,
  };
}
