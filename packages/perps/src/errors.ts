/**
 * Typed errors for the perps package.
 *
 * - `PerpsValidationError` — a descriptor or policy input is invalid
 *   (client-side, before anything is built); carries the `field`.
 * - `RiskCheckError` — a pre-trade risk evaluation REFUSED the order.
 *   This is a refusal, not a validation detail: the order does not
 *   proceed, and the `code` says which gate stopped it.
 */

export class PerpsValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "PerpsValidationError";
    this.field = field;
  }
}

export type RiskRefusalCode =
  | "kill-switch"
  | "empty-market"
  | "notional-cap"
  | "leverage-cap"
  | "exposure-cap"
  | "daily-loss-cap"
  | "sizing-floor";

export class RiskCheckError extends Error {
  readonly code: RiskRefusalCode;
  constructor(code: RiskRefusalCode, message: string) {
    super(message);
    this.name = "RiskCheckError";
    this.code = code;
  }
}

export function isPerpsValidationError(e: unknown): e is PerpsValidationError {
  return e instanceof PerpsValidationError;
}

export function isRiskCheckError(e: unknown): e is RiskCheckError {
  return e instanceof RiskCheckError;
}
