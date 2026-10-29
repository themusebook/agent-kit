import { PublicKey } from "@solana/web3.js";

/**
 * pump.fun agent flows — flow DESCRIPTORS for the fun-block agent API
 * (`POST https://fun-block.pump.fun/agents/...`), grounded in the
 * owner's pump skill family (create-coin / swap / fees / payments).
 *
 * Doctrine, same as the rest of finance: this module BUILDS and
 * validates requests. The API answers with an unsigned (or partially
 * signed) transaction; the USER co-signs in their own wallet; the
 * agent never signs for the user and never broadcasts on its own
 * initiative. Submission happens only when the caller explicitly
 * invokes the adapter — and the response still needs the user's
 * signature before anything can land.
 *
 * Honesty note: the endpoint/field contract follows the skills'
 * documented surface. The fun-block host was verified live
 * (2026-09-19) but the full POST flows were NOT live-tested
 * end-to-end — dry-run first, verify the returned transaction before
 * asking anyone to sign it.
 */

export const PUMP_AGENT_API_BASE = "https://fun-block.pump.fun";

export class PumpValidationError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "PumpValidationError";
    this.field = field;
  }
}

export class PumpApiNetworkError extends Error {
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PumpApiNetworkError";
    this.cause = cause;
  }
}

export class PumpApiError extends Error {
  readonly statusCode: number;
  readonly responseBody: unknown;
  constructor(statusCode: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = "PumpApiError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export function isPumpValidationError(e: unknown): e is PumpValidationError {
  return e instanceof PumpValidationError;
}

export function isPumpApiNetworkError(e: unknown): e is PumpApiNetworkError {
  return e instanceof PumpApiNetworkError;
}

export function isPumpApiError(e: unknown): e is PumpApiError {
  return e instanceof PumpApiError;
}

function assertPubkey(field: string, value: string): void {
  try {
    new PublicKey(value);
  } catch {
    throw new PumpValidationError(field, `${field} must be a valid Solana public key`);
  }
}

const UNSIGNED_TX_WARNING =
  "The API returns an unsigned/partially-signed transaction: the USER co-signs in their own wallet. The agent never signs for the user.";
const NOT_LIVE_TESTED_WARNING =
  "Field contract follows the documented fun-block agent API surface; the full POST flow was not live-tested end-to-end — dry-run first and verify the returned transaction before signing.";

export interface PumpRequestDescriptor<Body = Record<string, unknown>> {
  kind: string;
  /** Absolute endpoint the adapter POSTs to. */
  endpoint: string;
  body: Body;
  /** How the transaction comes back: base64, to be decoded and co-signed by the user. */
  transactionEncoding: "base64";
  /** Always true for this API: nothing lands without the user's signature. */
  requiresUserSignature: true;
  warnings: string[];
}

// ------------------------------------------------------------ create-coin

export interface PumpCreateCoinMetadata {
  name: string;
  symbol: string;
  description?: string;
  /** Image URL (hosted by the caller). */
  image: string;
}

export interface PumpCreateCoinInput {
  metadata: PumpCreateCoinMetadata;
  /** Optional first buy, in SOL. */
  initialBuySol?: number;
  /** Route trading cashback to buyers. */
  cashback?: boolean;
  /** Mayhem mode for the launch. */
  mayhem?: boolean;
  /** Tokenized-agent fee share, in bps. */
  tokenizedAgentBps?: number;
  /** Buyback fee share, in bps. */
  buybackBps?: number;
  /** Submit via Jito only. */
  jitoOnly?: boolean;
}

export function buildCreateCoinRequest(
  input: PumpCreateCoinInput,
): PumpRequestDescriptor {
  const { metadata } = input;
  if (!metadata.name) throw new PumpValidationError("metadata.name", "metadata.name is required");
  if (!metadata.symbol) {
    throw new PumpValidationError("metadata.symbol", "metadata.symbol is required");
  }
  if (!metadata.image) throw new PumpValidationError("metadata.image", "metadata.image is required");
  for (const [field, bps] of [
    ["tokenizedAgentBps", input.tokenizedAgentBps],
    ["buybackBps", input.buybackBps],
  ] as const) {
    if (bps !== undefined && (!Number.isInteger(bps) || bps < 0 || bps > 10_000)) {
      throw new PumpValidationError(field, `${field} must be an integer between 0 and 10000`);
    }
  }
  if (input.initialBuySol !== undefined && !(input.initialBuySol > 0)) {
    throw new PumpValidationError("initialBuySol", "initialBuySol must be positive when given");
  }
  return {
    kind: "pumpCreateCoin",
    endpoint: `${PUMP_AGENT_API_BASE}/agents/create-coin`,
    body: {
      metadata: input.metadata,
      ...(input.initialBuySol !== undefined ? { initialBuySol: input.initialBuySol } : {}),
      ...(input.cashback !== undefined ? { cashback: input.cashback } : {}),
      ...(input.mayhem !== undefined ? { mayhem: input.mayhem } : {}),
      ...(input.tokenizedAgentBps !== undefined
        ? { tokenizedAgentBps: input.tokenizedAgentBps }
        : {}),
      ...(input.buybackBps !== undefined ? { buybackBps: input.buybackBps } : {}),
      ...(input.jitoOnly !== undefined ? { jitoOnly: input.jitoOnly } : {}),
    },
    transactionEncoding: "base64",
    requiresUserSignature: true,
    warnings: [UNSIGNED_TX_WARNING, NOT_LIVE_TESTED_WARNING],
  };
}

// ------------------------------------------------------------------ swap

/** Where the token trades right now — the swap route DIFFERS by state; check before building. */
export type PumpMarketState = "bonding-curve" | "graduated-amm";

export interface PumpSwapInput {
  mint: string;
  side: "buy" | "sell";
  /** Buy amount in SOL (exactly one of amountSol / amountTokens). */
  amountSol?: number;
  /** Sell amount in tokens (exactly one of amountSol / amountTokens). */
  amountTokens?: number;
  /**
   * Slippage protection in bps — REQUIRED on every trade. There is no
   * safe default to invent: the caller states the protection.
   */
  slippageBps: number;
  /** The token's current market state (bonding curve vs graduated Pump AMM). */
  marketState: PumpMarketState;
  jitoOnly?: boolean;
}

export function buildSwapRequest(input: PumpSwapInput): PumpRequestDescriptor {
  assertPubkey("mint", input.mint);
  if (input.side !== "buy" && input.side !== "sell") {
    throw new PumpValidationError("side", 'side must be "buy" or "sell"');
  }
  const hasSol = input.amountSol !== undefined;
  const hasTokens = input.amountTokens !== undefined;
  if (hasSol === hasTokens) {
    throw new PumpValidationError(
      "amount",
      "exactly one of amountSol / amountTokens is required",
    );
  }
  if (hasSol && !(input.amountSol! > 0)) {
    throw new PumpValidationError("amountSol", "amountSol must be positive");
  }
  if (hasTokens && !(input.amountTokens! > 0)) {
    throw new PumpValidationError("amountTokens", "amountTokens must be positive");
  }
  if (
    !Number.isInteger(input.slippageBps) ||
    input.slippageBps < 0 ||
    input.slippageBps > 10_000
  ) {
    throw new PumpValidationError(
      "slippageBps",
      "slippageBps is REQUIRED on every trade and must be an integer between 0 and 10000",
    );
  }
  if (input.marketState !== "bonding-curve" && input.marketState !== "graduated-amm") {
    throw new PumpValidationError(
      "marketState",
      'marketState must be "bonding-curve" or "graduated-amm" — check the curve state before building; the routes differ',
    );
  }
  return {
    kind: "pumpSwap",
    endpoint: `${PUMP_AGENT_API_BASE}/agents/swap`,
    body: {
      mint: input.mint,
      side: input.side,
      ...(hasSol ? { amountSol: input.amountSol } : { amountTokens: input.amountTokens }),
      slippageBps: input.slippageBps,
      marketState: input.marketState,
      ...(input.jitoOnly !== undefined ? { jitoOnly: input.jitoOnly } : {}),
    },
    transactionEncoding: "base64",
    requiresUserSignature: true,
    warnings: [
      UNSIGNED_TX_WARNING,
      "Quote first and show the expected output; get a FRESH user approval of the exact terms before submitting.",
      input.marketState === "graduated-amm"
        ? "Token has graduated: this swap routes through the Pump AMM, not the bonding curve."
        : "Token is on the bonding curve: this swap routes through the curve, not the graduated AMM.",
      NOT_LIVE_TESTED_WARNING,
    ],
  };
}

// ------------------------------------------------------------------ fees

export interface PumpCollectFeesInput {
  mint: string;
  /** "creator" collects direct creator fees; "cashback" collects trading cashback. */
  kind: "creator" | "cashback";
}

export function buildCollectFeesRequest(
  input: PumpCollectFeesInput,
): PumpRequestDescriptor {
  assertPubkey("mint", input.mint);
  if (input.kind !== "creator" && input.kind !== "cashback") {
    throw new PumpValidationError("kind", 'kind must be "creator" or "cashback"');
  }
  return {
    kind: "pumpCollectFees",
    endpoint: `${PUMP_AGENT_API_BASE}/agents/collect-fees`,
    body: { mint: input.mint, kind: input.kind },
    transactionEncoding: "base64",
    requiresUserSignature: true,
    warnings: [
      UNSIGNED_TX_WARNING,
      "Inspect the creator-fee destination BEFORE collecting (buildFeeSharingConfigRequest covers the split configuration).",
      NOT_LIVE_TESTED_WARNING,
    ],
  };
}

export interface PumpFeeSharingConfigInput {
  mint: string;
  /** Fee recipients; shares are bps and MUST sum to exactly 10000. */
  recipients: Array<{ wallet: string; shareBps: number }>;
}

export function buildFeeSharingConfigRequest(
  input: PumpFeeSharingConfigInput,
): PumpRequestDescriptor {
  assertPubkey("mint", input.mint);
  if (!input.recipients || input.recipients.length === 0) {
    throw new PumpValidationError("recipients", "at least one fee recipient is required");
  }
  let total = 0;
  for (const [i, r] of input.recipients.entries()) {
    assertPubkey(`recipients[${i}].wallet`, r.wallet);
    if (!Number.isInteger(r.shareBps) || r.shareBps < 0 || r.shareBps > 10_000) {
      throw new PumpValidationError(
        `recipients[${i}].shareBps`,
        "shareBps must be an integer between 0 and 10000",
      );
    }
    total += r.shareBps;
  }
  if (total !== 10_000) {
    throw new PumpValidationError(
      "recipients",
      `fee shares must sum to exactly 10000 bps (got ${total})`,
    );
  }
  return {
    kind: "pumpFeeSharingConfig",
    endpoint: `${PUMP_AGENT_API_BASE}/agents/sharing-config`,
    body: { mint: input.mint, recipients: input.recipients },
    transactionEncoding: "base64",
    requiresUserSignature: true,
    warnings: [UNSIGNED_TX_WARNING, NOT_LIVE_TESTED_WARNING],
  };
}

// ------------------------------------------------------- agent payments

export interface PumpAgentPaymentInvoiceInput {
  /** What is being sold. */
  service: string;
  /** Price in the invoice currency's major unit (e.g. 0.05 SOL). */
  price: number;
  currency: "SOL" | "USDC";
  /** The paying wallet, when known. */
  payer?: string;
  /**
   * The invoice's identity. On-chain, invoices are anchored by an
   * Invoice ID PDA: the SAME invoice id cannot be paid twice — that
   * PDA is the duplicate protection. Supply the id your integration
   * derived; the SDK (@pump-fun/agent-payments-sdk) derives it.
   */
  invoiceId?: string;
}

export interface PumpAgentPaymentInvoice {
  kind: "pumpAgentPaymentInvoice";
  service: string;
  price: number;
  currency: "SOL" | "USDC";
  payer?: string;
  invoiceId?: string;
  duplicateProtection: "invoice-id-pda";
  /** The server MUST verify the payment on-chain before delivering. Never deliver on an unverified claim. */
  verifyOnChainBeforeDelivery: true;
  sdk: "@pump-fun/agent-payments-sdk";
  warnings: string[];
}

export function buildAgentPaymentInvoice(
  input: PumpAgentPaymentInvoiceInput,
): PumpAgentPaymentInvoice {
  if (!input.service) throw new PumpValidationError("service", "service is required");
  if (!(input.price > 0)) throw new PumpValidationError("price", "price must be positive");
  if (input.currency !== "SOL" && input.currency !== "USDC") {
    throw new PumpValidationError("currency", 'currency must be "SOL" or "USDC"');
  }
  if (input.payer) assertPubkey("payer", input.payer);
  return {
    kind: "pumpAgentPaymentInvoice",
    service: input.service,
    price: input.price,
    currency: input.currency,
    ...(input.payer ? { payer: input.payer } : {}),
    ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
    duplicateProtection: "invoice-id-pda",
    verifyOnChainBeforeDelivery: true,
    sdk: "@pump-fun/agent-payments-sdk",
    warnings: [
      "The user signs the payment in their own wallet; the SERVER verifies the payment ON-CHAIN before delivering the service — never deliver on an unverified claim.",
      "The Invoice ID PDA makes the invoice duplicate-safe: the same invoice cannot be paid twice.",
    ],
  };
}

// --------------------------------------------------------------- adapter

/** Caller-supplied submission channel for pump flow descriptors. */
export interface PumpRequestAdapter {
  submit(
    descriptor: PumpRequestDescriptor,
  ): Promise<{ transactionBase64?: string; raw?: unknown }>;
}

/**
 * The stock HTTP adapter: POSTs the descriptor body to its fun-block
 * endpoint and returns the unsigned transaction for the USER to
 * co-sign. Invoking `submit` is the caller's explicit decision —
 * builders never call it for you, and even a submitted request only
 * produces a transaction that still needs the user's signature.
 */
export function createPumpHttpAdapter(fetchImpl: typeof fetch = fetch): PumpRequestAdapter {
  return {
    async submit(descriptor) {
      let res: Response;
      try {
        res = await fetchImpl(descriptor.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(descriptor.body),
        });
      } catch (e) {
        throw new PumpApiNetworkError(
          `Could not reach the pump.fun agent API at ${descriptor.endpoint}`,
          e,
        );
      }
      const bodyText = await res.text();
      if (!res.ok) {
        throw new PumpApiError(
          res.status,
          `pump.fun agent API failed: HTTP ${res.status}`,
          bodyText,
        );
      }
      let raw: unknown = bodyText;
      try {
        raw = JSON.parse(bodyText);
      } catch {
        /* keep the raw text */
      }
      const obj = (raw ?? {}) as Record<string, unknown>;
      const tx =
        typeof obj.transaction === "string"
          ? obj.transaction
          : typeof obj.transactionBase64 === "string"
            ? obj.transactionBase64
            : typeof obj.tx === "string"
              ? obj.tx
              : undefined;
      return { transactionBase64: tx, raw };
    },
  };
}
