/**
 * Typed errors for the perps package.
 *
 * - `PerpsValidationError` — a descriptor or input is invalid
 *   (client-side, before anything is built); carries the `field`.
 *
 * Risk refusals in this package are NOT exceptions: mirroring the
 * source repos, `buildPreflightReport` returns a report object with
 * `blocking` reasons (see risk.ts). Callers must check `ok` — a
 * blocked report means the order does not proceed.
 */

export class PerpsValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "PerpsValidationError";
    this.field = field;
  }
}

export function isPerpsValidationError(e: unknown): e is PerpsValidationError {
  return e instanceof PerpsValidationError;
}
