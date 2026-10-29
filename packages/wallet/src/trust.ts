/**
 * Progressive trust ladder (IDENTITY.md §14). Trust is STATE, not
 * personality: it is granted through an operator/policy path and is never
 * self-promoted just because credentials are present.
 */
export const TRUST_LEVELS = [
  "observer",
  "dry-run",
  "delegated",
  "autonomous",
  "sovereign",
] as const;

export type TrustLevel = (typeof TRUST_LEVELS)[number];

export function trustRank(level: TrustLevel): number {
  return TRUST_LEVELS.indexOf(level);
}

/** True when `current` meets or exceeds the `required` level. */
export function meetsTrust(current: TrustLevel, required: TrustLevel): boolean {
  return trustRank(current) >= trustRank(required);
}

/** Kit actions that carry a minimum trust level. */
export type KitAction =
  | "resolve" // read-only identity/discovery reads
  | "simulate" // build + simulate, never sign live
  | "sign-message" // SIWS / agent-token message signing
  | "pay" // a single x402 payment under policy
  | "message" // x402m mailbox send (proposals only)
  | "execute-treasury" // MPL Core Execute against the Asset Signer PDA
  | "register-identity"; // mint an agent identity (operator-confirmed)

export const ACTION_TRUST_REQUIREMENTS: Record<KitAction, TrustLevel> = {
  resolve: "observer",
  simulate: "dry-run",
  "sign-message": "delegated",
  pay: "delegated",
  message: "delegated",
  "execute-treasury": "autonomous",
  "register-identity": "delegated",
};

export function requiredTrust(action: KitAction): TrustLevel {
  return ACTION_TRUST_REQUIREMENTS[action];
}

/** Throws a plain Error when the level is insufficient; client wraps it typed. */
export function assertTrust(current: TrustLevel, action: KitAction): void {
  const required = requiredTrust(action);
  if (!meetsTrust(current, required)) {
    throw new Error(
      `Action "${action}" requires trust level "${required}"; current level is "${current}".`,
    );
  }
}
