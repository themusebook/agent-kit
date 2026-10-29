/**
 * Typed errors for the Clawd A2A relay.
 *
 * - `A2AValidationError` — client-side validation failed BEFORE any
 *   relay call (bad handle shape, oversized body, ttl out of range,
 *   unknown message type); carries the offending `field`.
 * - `A2AError` — the relay answered non-2xx; carries `status`, the
 *   relay's error `code` when it sends one (live shape:
 *   `{ ok: false, error: "<code>", message: "<human text>" }`), and
 *   the raw `responseBody`.
 * - `A2AAuthError` — HTTP 401: missing/invalid bearer token.
 * - `A2AHandleTakenError` — HTTP 409 `handle_taken`: handles are
 *   first-come, first-served. This is a final answer, not a prompt to
 *   silently pick a different handle.
 * - `A2ANetworkError` — the relay endpoint was unreachable.
 */

export class A2AValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "A2AValidationError";
    this.field = field;
  }
}

export class A2AError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly responseBody?: unknown;
  constructor(
    status: number,
    message: string,
    opts: { code?: string; responseBody?: unknown } = {},
  ) {
    super(message);
    this.name = "A2AError";
    this.status = status;
    this.code = opts.code;
    this.responseBody = opts.responseBody;
  }
}

export class A2AAuthError extends A2AError {
  constructor(message = "Valid Bearer token required.", opts: { responseBody?: unknown } = {}) {
    super(401, message, { code: "unauthorized", ...opts });
    this.name = "A2AAuthError";
  }
}

export class A2AHandleTakenError extends A2AError {
  readonly handle: string;
  constructor(handle: string, message?: string, opts: { responseBody?: unknown } = {}) {
    super(409, message ?? `Handle "${handle}" is already registered.`, {
      code: "handle_taken",
      ...opts,
    });
    this.name = "A2AHandleTakenError";
    this.handle = handle;
  }
}

export class A2ANetworkError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "A2ANetworkError";
    this.cause = cause;
  }
}

export function isA2AValidationError(e: unknown): e is A2AValidationError {
  return e instanceof A2AValidationError;
}
export function isA2AError(e: unknown): e is A2AError {
  return e instanceof A2AError;
}
export function isA2AAuthError(e: unknown): e is A2AAuthError {
  return e instanceof A2AAuthError;
}
export function isA2AHandleTakenError(e: unknown): e is A2AHandleTakenError {
  return e instanceof A2AHandleTakenError;
}
export function isA2ANetworkError(e: unknown): e is A2ANetworkError {
  return e instanceof A2ANetworkError;
}
