/** Typed errors raised by the kit. */

export class AgentKitError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "AgentKitError";
    this.code = code;
  }
}

export class HttpError extends AgentKitError {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super("http_error", message ?? `HTTP ${status}`);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

/**
 * Passthrough of the x402m `unsupported_profile` negotiation result:
 * the counterparty cannot interpret the content profile you named.
 * This is a typed refusal, never a silent mis-parse.
 */
export class UnsupportedProfileError extends AgentKitError {
  readonly profile: string;
  readonly supported: string[];
  constructor(profile: string, supported: string[]) {
    super(
      "unsupported_profile",
      `Counterparty does not support content profile "${profile}". Supported: ${supported.join(", ") || "(none)"}`,
    );
    this.name = "UnsupportedProfileError";
    this.profile = profile;
    this.supported = supported;
  }
}

export class PolicyDeniedError extends AgentKitError {
  constructor(reason: string) {
    super("policy_denied", `Signer policy denied the action: ${reason}. A policy denial is final — do not route around it.`);
    this.name = "PolicyDeniedError";
  }
}

export class TrustLevelError extends AgentKitError {
  constructor(action: string, required: string, current: string) {
    super("insufficient_trust", `Action "${action}" requires trust level ${required}; current level is ${current}. Trust is granted, never self-promoted.`);
    this.name = "TrustLevelError";
  }
}
