import type { MessageSigner } from "@musebook/wallet";

/**
 * x402 payments against the Musebook facilitator.
 *
 * Flow: a resource answers 402 with a payment challenge → the payer signs
 * (via the caller-supplied signer — the kit holds no keys) → the
 * facilitator verifies + settles → the recipient VERIFIES the receipt
 * independently. A receipt is a claim until the settlement transaction is
 * confirmed onchain; `verifyReceipt` does that check.
 *
 * ASSUMPTION: challenge/payload shapes follow x402 v1 `exact` as deployed
 * by the live facilitator today (the v2 work is still upstream in review —
 * the kit documents deployed versions, not drafts).
 */

export interface PaymentsConfig {
  hub: string;
  rpc: string;
  /** Facilitator base URL. Default: the hub. */
  facilitator?: string;
}

export interface PaymentRequirement {
  scheme: string; // "exact"
  network: string; // CAIP-2, e.g. solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp
  maxAmountRequired: string;
  asset: string; // CAIP-19 / mint
  payTo: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface PaymentChallenge {
  x402Version: number;
  accepts: PaymentRequirement[];
  error?: string;
  raw: unknown;
}

/** Parse a 402 response (JSON body shape, or the base64 X-PAYMENT header). */
export function parsePaymentChallenge(body: unknown, headerValue?: string | null): PaymentChallenge {
  let parsed: Record<string, unknown> | null = null;
  if (typeof body === "object" && body !== null && "accepts" in (body as Record<string, unknown>)) {
    parsed = body as Record<string, unknown>;
  } else if (headerValue) {
    try {
      parsed = JSON.parse(Buffer.from(headerValue, "base64").toString("utf8")) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  }
  if (!parsed || !Array.isArray(parsed.accepts)) {
    throw new Error("Not an x402 payment challenge (no accepts[])");
  }
  return {
    x402Version: typeof parsed.x402Version === "number" ? parsed.x402Version : 1,
    accepts: parsed.accepts as PaymentRequirement[],
    error: typeof parsed.error === "string" ? parsed.error : undefined,
    raw: body,
  };
}

export interface PaymentReceipt {
  success: boolean;
  transaction: string | null; // settlement signature
  network: string | null;
  payer: string | null;
  /** Set by verifyReceipt — a receipt is unverified until this is true. */
  verified: boolean;
  raw: unknown;
}

/**
 * Signer extension for payments: the caller provides a function that
 * produces the scheme payload (for SVM `exact`, a signed transaction)
 * from a requirement. Keeping this a callback keeps keys out of the kit.
 */
export type SignPayment = (
  requirement: PaymentRequirement,
  signer: MessageSigner,
) => Promise<{ payload: unknown; scheme: string }>;

export async function payChallenge(
  config: PaymentsConfig,
  challenge: PaymentChallenge,
  signer: MessageSigner,
  signPayment: SignPayment,
  requirementIndex = 0,
): Promise<PaymentReceipt> {
  const requirement = challenge.accepts[requirementIndex];
  if (!requirement) throw new Error(`No payment requirement at index ${requirementIndex}`);
  const facilitator = (config.facilitator ?? config.hub).replace(/\/$/, "");
  const { payload } = await signPayment(requirement, signer);
  const paymentPayload = {
    x402Version: challenge.x402Version,
    scheme: requirement.scheme,
    network: requirement.network,
    payload,
  };

  const verifyRes = await fetch(`${facilitator}/api/x402/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements: requirement }),
  });
  if (!verifyRes.ok) throw new Error(`Facilitator verify failed: HTTP ${verifyRes.status}`);
  const verifyBody = (await verifyRes.json()) as Record<string, unknown>;
  if (verifyBody.isValid === false) {
    throw new Error(`Facilitator rejected payment: ${String(verifyBody.invalidReason ?? "invalid")}`);
  }

  const settleRes = await fetch(`${facilitator}/api/x402/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ paymentPayload, paymentRequirements: requirement }),
  });
  if (!settleRes.ok) throw new Error(`Facilitator settle failed: HTTP ${settleRes.status}`);
  const settle = (await settleRes.json()) as Record<string, unknown>;
  const receipt: PaymentReceipt = {
    success: settle.success !== false,
    transaction: typeof settle.transaction === "string" ? settle.transaction : null,
    network: typeof settle.network === "string" ? settle.network : requirement.network,
    payer: typeof settle.payer === "string" ? settle.payer : signer.publicKey,
    verified: false,
    raw: settle,
  };
  if (receipt.transaction) {
    receipt.verified = await verifyReceipt(config, receipt);
  }
  return receipt;
}

/** Independently confirm a settlement signature onchain (finalized, no error). */
export async function verifyReceipt(
  config: PaymentsConfig,
  receipt: PaymentReceipt,
): Promise<boolean> {
  if (!receipt.transaction) return false;
  const res = await fetch(config.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "agent-kit",
      method: "getSignatureStatuses",
      params: [[receipt.transaction], { searchTransactionHistory: true }],
    }),
  });
  const json = (await res.json()) as {
    result?: { value?: Array<{ confirmationStatus?: string; err?: unknown } | null> };
  };
  const status = json.result?.value?.[0];
  return Boolean(status && !status.err && status.confirmationStatus === "finalized");
}
