import type { AuthTokenStore } from "./tokenStore";

/**
 * The three Metaplex x402 payment modes as typed scheme descriptors,
 * alongside (not replacing) the hub facilitator's v1 `exact` flow in
 * x402.ts:
 *
 * 1. **Standard wallet** — a normal wallet signs an ExactSvmScheme
 *    payment. The payer is the wallet.
 * 2. **Core asset / agent direct** — a MetaplexSvmExactScheme payment
 *    executed FROM the agent: Core Execute spends out of the Asset
 *    Signer PDA, so the agent itself is the payer. Requires the asset
 *    (and optionally its collection for account resolution).
 * 3. **Delegated agent (Mech)** — a delegate operates under a Mech
 *    authorization: status / approve / revoke are managed against the
 *    delegate endpoints, and requests carry a ~24h auth token (see
 *    tokenStore.ts).
 *
 * Asset rule for ALL modes: **USDC on the classic SPL Token program
 * only.** Token-2022 USDC is NOT supported by these schemes.
 *
 * Execute-mode rule (2 and 3): the signer PDA must hold SOL — Core
 * Execute transactions still pay network fees from the PDA.
 *
 * Tie-in: an agent advertising x402 support sets `x402Support: true` in
 * its EIP-8004 registration document (identity package); the modes here
 * are how that advertisement is honored.
 */

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SPL_TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

/** Mode 1 — standard wallet (ExactSvmScheme). */
export interface StandardWalletScheme {
  kind: "standard-wallet";
  scheme: "ExactSvmScheme";
  /** The paying wallet's public key. */
  signer: string;
}

/** Mode 2 — Core asset / agent direct (MetaplexSvmExactScheme + execute). */
export interface CoreAssetScheme {
  kind: "core-asset";
  scheme: "MetaplexSvmExactScheme";
  coreExecute: {
    /** The agent's MPL Core asset — payment executes from its Asset Signer PDA. */
    asset: string;
    collection?: string;
  };
}

/** Mode 3 — delegated agent (Mech). */
export interface DelegatedAgentScheme {
  kind: "delegated-agent";
  scheme: "Mech";
  /** The Mech delegate identity operating the agent's payments. */
  delegate: string;
}

export type X402PaymentScheme =
  | StandardWalletScheme
  | CoreAssetScheme
  | DelegatedAgentScheme;

export type X402PaymentMode = X402PaymentScheme["kind"];

export function isExecuteMode(scheme: X402PaymentScheme): boolean {
  return scheme.kind === "core-asset" || scheme.kind === "delegated-agent";
}

/**
 * Validate a payment asset for these schemes: USDC, classic SPL only.
 * Returns problems (empty = acceptable).
 */
export function validatePaymentAsset(input: {
  asset: string;
  tokenProgram?: string;
  network?: "devnet" | "mainnet-beta";
}): string[] {
  const problems: string[] = [];
  const expected =
    input.network === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
  if (input.asset !== expected) {
    problems.push(
      `unsupported asset ${input.asset}: the Metaplex x402 modes settle USDC (${expected}) only`,
    );
  }
  if (input.tokenProgram !== undefined && input.tokenProgram !== SPL_TOKEN_PROGRAM) {
    problems.push(
      input.tokenProgram === TOKEN_2022_PROGRAM
        ? "Token-2022 USDC is not supported by these schemes — use classic SPL USDC"
        : `unsupported token program ${input.tokenProgram}: classic SPL Token program only`,
    );
  }
  return problems;
}

/**
 * Validate scheme-level requirements. For execute modes the signer PDA
 * SOL balance matters: when `signerPdaLamports` is provided, a zero
 * balance is a hard problem (the execute transaction cannot pay fees);
 * when it is not provided, the requirement is still reported so callers
 * check before attempting payment.
 */
export function validateSchemeRequirements(
  scheme: X402PaymentScheme,
  opts: { signerPdaLamports?: number } = {},
): string[] {
  const problems: string[] = [];
  if (isExecuteMode(scheme)) {
    if (opts.signerPdaLamports === undefined) {
      problems.push(
        "execute modes require the signer PDA to hold SOL for network fees — verify its balance before paying",
      );
    } else if (opts.signerPdaLamports <= 0) {
      problems.push(
        "signer PDA holds no SOL — Core Execute payments cannot pay network fees",
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Client style: reactive extension XOR proactive wrapper.
//
// Two integration styles exist for attaching x402 payment handling to an
// HTTP client, and they are MUTUALLY EXCLUSIVE — installing both double-
// handles 402s (the extension retries a request the wrapper already paid,
// or vice versa). The union type makes the conflict unrepresentable in
// typed code; assertSingleX402Style guards untyped (runtime) configs.
// ---------------------------------------------------------------------------

export type X402ClientStyle =
  | { kind: "reactive"; extension: unknown }
  | { kind: "proactive"; wrapper: unknown };

export class X402StyleConflictError extends Error {
  constructor() {
    super(
      "x402 client style conflict: reactive extension and proactive wrapper are mutually exclusive — pick exactly one.",
    );
    this.name = "X402StyleConflictError";
  }
}

export function assertSingleX402Style(config: Record<string, unknown>): void {
  const hasReactive = config.kind === "reactive" || "extension" in config;
  const hasProactive = config.kind === "proactive" || "wrapper" in config;
  if (hasReactive && hasProactive) throw new X402StyleConflictError();
  if (!hasReactive && !hasProactive) {
    throw new Error(
      "x402 client style missing: provide exactly one of a reactive extension or a proactive wrapper.",
    );
  }
}

// ---------------------------------------------------------------------------
// Mech delegate management (mode 3).
//
// Endpoint paths are NOT hardcoded: they come from the deployment's
// delegate configuration (discovery document / operator config), passed
// in by the caller. The client attaches the stored 24h auth token as a
// bearer credential and never invents URLs.
// ---------------------------------------------------------------------------

export interface MechDelegateEndpoints {
  status: string;
  approve: string;
  revoke: string;
}

export interface MechDelegateStatus {
  delegate: string;
  status: string;
  raw: unknown;
}

export class MechDelegateClient {
  constructor(
    private readonly baseUrl: string,
    private readonly endpoints: MechDelegateEndpoints,
    private readonly tokenStore: AuthTokenStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<unknown> {
    const token = await this.tokenStore.get();
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method: init.method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      throw new Error(`Mech delegate call failed: HTTP ${res.status} (${init.method} ${path})`);
    }
    return res.json().catch(() => null);
  }

  async status(delegate: string): Promise<MechDelegateStatus> {
    const raw = await this.call(this.endpoints.status, {
      method: "POST",
      body: { delegate },
    });
    const obj = (raw ?? {}) as Record<string, unknown>;
    return {
      delegate,
      status: typeof obj.status === "string" ? obj.status : "unknown",
      raw,
    };
  }

  async approve(delegate: string): Promise<unknown> {
    return this.call(this.endpoints.approve, { method: "POST", body: { delegate } });
  }

  /** Revoking also clears the local auth token — it is dead either way. */
  async revoke(delegate: string): Promise<unknown> {
    try {
      return await this.call(this.endpoints.revoke, {
        method: "POST",
        body: { delegate },
      });
    } finally {
      await this.tokenStore.clear();
    }
  }
}
