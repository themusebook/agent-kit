/**
 * Typed errors for the hosted Agent API, mirroring the taxonomy of
 * @metaplex-foundation/mpl-agent-registry so callers can branch the same
 * way they would with the upstream SDK:
 *
 * - `AgentValidationError` — client-side validation failed BEFORE the API
 *   was called; carries the offending `field`.
 * - `AgentApiNetworkError` — the API endpoint was unreachable.
 * - `AgentApiError` — the API answered with a non-2xx status; carries
 *   `statusCode` and the raw `responseBody`.
 */

export interface FieldProblem {
  field: string;
  message: string;
}

export class AgentValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "AgentValidationError";
    this.field = field;
  }
}

export class AgentApiNetworkError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AgentApiNetworkError";
    this.cause = cause;
  }
}

export class AgentApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: unknown;
  constructor(statusCode: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = "AgentApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function isAgentValidationError(e: unknown): e is AgentValidationError {
  return e instanceof AgentValidationError;
}

export function isAgentApiNetworkError(e: unknown): e is AgentApiNetworkError {
  return e instanceof AgentApiNetworkError;
}

export function isAgentApiError(e: unknown): e is AgentApiError {
  return e instanceof AgentApiError;
}
