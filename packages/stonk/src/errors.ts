/**
 * Typed errors for the Stonkfun Developer API.
 *
 * - `StonkValidationError` — client-side validation failed BEFORE any
 *   API call (bad input, a derived account that disagrees with the
 *   pricing response, a tax tier the platform does not publish);
 *   carries the offending `field`.
 * - `StonkNetworkError` — the API endpoint was unreachable.
 * - `StonkApiError` — the API answered non-2xx; carries `statusCode`,
 *   the venue's error `code` when it sends one (v1 shape
 *   `{ error: { code, message } }`; v2 sends `{ error: string }` with
 *   no code), and the raw `responseBody`.
 * - `StonkRateLimitError` — HTTP 429; carries the `Retry-After` value
 *   and the parsed rate-limit headers so callers can back off politely.
 * - `StonkClaimForbiddenError` — 403 on a fee-claim call: the launch
 *   has NO creator position to claim from (LaunchLab launches
 *   auto-forward creator fees; reward and pump launches have no
 *   creator position at all).
 * - `StonkNothingClaimableError` — 409 on a fee-claim call: a position
 *   exists but nothing is claimable yet.
 */

export class StonkValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "StonkValidationError";
    this.field = field;
  }
}

export class StonkNetworkError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "StonkNetworkError";
    this.cause = cause;
  }
}

export interface StonkRateLimitInfo {
  /** X-RateLimit-Remaining on the last response, when sent. */
  remaining?: number;
  /** X-RateLimit-Reset on the last response (epoch seconds), when sent. */
  reset?: number;
  /** Retry-After on a 429 (seconds), when sent. */
  retryAfterSeconds?: number;
}

export class StonkApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly responseBody: unknown;
  readonly rateLimit?: StonkRateLimitInfo;
  constructor(
    statusCode: number,
    message: string,
    opts: { code?: string; responseBody?: unknown; rateLimit?: StonkRateLimitInfo } = {},
  ) {
    super(message);
    this.name = "StonkApiError";
    this.statusCode = statusCode;
    this.code = opts.code;
    this.responseBody = opts.responseBody;
    this.rateLimit = opts.rateLimit;
  }
}

export class StonkRateLimitError extends StonkApiError {
  readonly retryAfterSeconds?: number;
  constructor(message: string, opts: { responseBody?: unknown; rateLimit?: StonkRateLimitInfo } = {}) {
    super(429, message, opts);
    this.name = "StonkRateLimitError";
    this.retryAfterSeconds = opts.rateLimit?.retryAfterSeconds;
  }
}

export class StonkClaimForbiddenError extends StonkApiError {
  constructor(message: string, opts: { code?: string; responseBody?: unknown } = {}) {
    super(403, message, opts);
    this.name = "StonkClaimForbiddenError";
  }
}

export class StonkNothingClaimableError extends StonkApiError {
  constructor(message: string, opts: { code?: string; responseBody?: unknown } = {}) {
    super(409, message, opts);
    this.name = "StonkNothingClaimableError";
  }
}

export function isStonkValidationError(e: unknown): e is StonkValidationError {
  return e instanceof StonkValidationError;
}

export function isStonkNetworkError(e: unknown): e is StonkNetworkError {
  return e instanceof StonkNetworkError;
}

export function isStonkApiError(e: unknown): e is StonkApiError {
  return e instanceof StonkApiError;
}

export function isStonkRateLimitError(e: unknown): e is StonkRateLimitError {
  return e instanceof StonkRateLimitError;
}

export function isStonkClaimForbiddenError(e: unknown): e is StonkClaimForbiddenError {
  return e instanceof StonkClaimForbiddenError;
}

export function isStonkNothingClaimableError(e: unknown): e is StonkNothingClaimableError {
  return e instanceof StonkNothingClaimableError;
}
