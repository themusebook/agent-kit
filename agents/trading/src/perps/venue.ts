import type { UnsignedTx } from "../unsigned.ts";

export type PerpSide = "long" | "short";

export interface PerpOrderIntent {
  venue: "phoenix" | "imperial";
  symbol: string;
  side: PerpSide;
  /** Base units of the market (e.g. SOL), as a decimal string. */
  baseUnits: string;
  /** Worst acceptable price in USD; required, so no order is unbounded. */
  priceLimitUsd: number;
  /** Wallet that owns the trader account and signs. */
  authority: string;
  reduceOnly?: boolean;
}

export type OrderResult =
  | { status: "unsigned"; tx: UnsignedTx }
  | { status: "disabled"; reason: string; preview: PerpOrderIntent };

export interface PerpsVenue {
  readonly id: "phoenix" | "imperial";
  markets(): Promise<unknown>;
  positions(wallet: string): Promise<unknown>;
  buildOrder(intent: PerpOrderIntent, ctx: { recentBlockhash: string }): Promise<OrderResult>;
}

export const MAX_LEVERAGE = 1;

export function checkIntent(i: PerpOrderIntent): void {
  if (!/^[A-Z0-9]{1,16}(-PERP)?$/i.test(i.symbol)) throw new Error("invalid market symbol");
  if (i.side !== "long" && i.side !== "short") throw new Error("side must be long or short");
  if (!/^\d+(\.\d+)?$/.test(i.baseUnits) || Number(i.baseUnits) <= 0) throw new Error("baseUnits must be a positive decimal");
  if (!Number.isFinite(i.priceLimitUsd) || i.priceLimitUsd <= 0) throw new Error("priceLimitUsd is required");
}
