/**
 * Typed errors for the Genesis API, mirroring the documented taxonomy
 * (isGenesisValidationError / isGenesisApiNetworkError / isGenesisApiError):
 *
 * - `GenesisValidationError` — client-side validation failed BEFORE any
 *   API call; carries the offending `field`.
 * - `GenesisApiNetworkError` — the API endpoint was unreachable.
 * - `GenesisApiError` — the API answered non-2xx; carries `statusCode`
 *   and the raw `responseBody`.
 */

export class GenesisValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "GenesisValidationError";
    this.field = field;
  }
}

export class GenesisApiNetworkError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "GenesisApiNetworkError";
    this.cause = cause;
  }
}

export class GenesisApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: unknown;
  constructor(statusCode: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = "GenesisApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function isGenesisValidationError(e: unknown): e is GenesisValidationError {
  return e instanceof GenesisValidationError;
}

export function isGenesisApiNetworkError(e: unknown): e is GenesisApiNetworkError {
  return e instanceof GenesisApiNetworkError;
}

export function isGenesisApiError(e: unknown): e is GenesisApiError {
  return e instanceof GenesisApiError;
}

/**
 * Thrown when a builder refuses to construct a PERMANENT action the
 * caller did not explicitly acknowledge. This is a refusal, not a
 * validation detail: the action (setAgentTokenV1) is one-shot and
 * irreversible, so the opt-in must be deliberate.
 */
export class PermanentBindingRefusalError extends Error {
  constructor(action: string) {
    super(
      `${action} is PERMANENT and one-shot: the token binding cannot be undone or replaced. ` +
        `Refusing to build it without an explicit acknowledgePermanent: true.`,
    );
    this.name = "PermanentBindingRefusalError";
  }
}
