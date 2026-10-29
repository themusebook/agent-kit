import type { StonkHttp, StonkSignTransaction } from "./client";
import {
  StonkApiError,
  StonkClaimForbiddenError,
  StonkNothingClaimableError,
  StonkValidationError,
} from "./errors";

/**
 * Fee claims — for launches that carry a creator position: a locked
 * position and its Fee Key NFT (the API-built standard launch path).
 *
 * Flow: read what is claimable (no wallet needed) → prepare (the
 * venue answers an UNSIGNED transaction, valid 90 seconds) → the
 * caller signs it AS-IS — it pays the caller; altering the
 * instructions invalidates it — → submit. Submission is idempotent:
 * resubmitting an intent that timed out returns the original
 * signature with `alreadySubmitted: true`, not an error and never a
 * second payment.
 *
 * Error semantics:
 * - 403 → there is no creator position for this launch. LaunchLab
 *   launches auto-forward creator fees (nothing to claim — the fees
 *   read says why); reward and pump launches have no creator position
 *   at all.
 * - 409 → a position exists but nothing is claimable yet.
 */

export interface StonkTokenFees {
  /** null when there is no creator position for the launch. */
  claimable: {
    quote?: { amountRaw?: string; amountTokens?: number | null; symbol?: string };
    base?: { amountRaw?: string; amountTokens?: number | null; symbol?: string };
    [key: string]: unknown;
  } | null;
  /**
   * Present on creator-quote-vault claims: `"creator-quote-vault"`
   * means the claim sweeps ALL of that creator's launches against
   * that quote asset in one claim — claim ONCE PER QUOTE, not per
   * mint. Surface this to callers so they don't loop mints.
   */
  scope?: string;
  /** Present when claimable is null — the venue explains (e.g. LaunchLab auto-forwarding). */
  reason?: string;
  [key: string]: unknown;
}

export interface FeeClaimPrepared {
  /** Unsigned, base64. Valid for 90 seconds. Sign AS-IS. */
  transaction: string;
  intentId: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface FeeClaimSubmitResult {
  signature: string;
  /** True when this intent was already submitted — the original signature is returned, not a second payment. */
  alreadySubmitted?: boolean;
  [key: string]: unknown;
}

function remapClaimError(e: unknown): unknown {
  if (e instanceof StonkApiError) {
    if (e.statusCode === 403) {
      return new StonkClaimForbiddenError(
        `${e.message} — no creator position: LaunchLab launches auto-forward creator fees and reward/pump launches have none`,
        { code: e.code, responseBody: e.responseBody },
      );
    }
    if (e.statusCode === 409) {
      return new StonkNothingClaimableError("nothing is claimable yet for this launch", {
        code: e.code,
        responseBody: e.responseBody,
      });
    }
  }
  return e;
}

/** GET /tokens/{mint}/fees — claimable balances, no wallet needed. Check `scope` before looping mints. */
export async function getTokenFees(http: StonkHttp, mint: string): Promise<StonkTokenFees> {
  return http.v1Get<StonkTokenFees>(`/tokens/${mint}/fees`);
}

/** POST /tokens/{mint}/fees/claim/prepare (rate limit: 20/min). 403/409 map to typed errors. */
export async function prepareFeeClaim(
  http: StonkHttp,
  mint: string,
  creatorWallet: string,
): Promise<FeeClaimPrepared> {
  if (!creatorWallet) {
    throw new StonkValidationError("creatorWallet", "prepareFeeClaim requires creatorWallet");
  }
  try {
    return await http.v1Post<FeeClaimPrepared>(`/tokens/${mint}/fees/claim/prepare`, {
      creatorWallet,
    });
  } catch (e) {
    throw remapClaimError(e);
  }
}

/** POST /tokens/{mint}/fees/claim/submit — idempotent per intentId. */
export async function submitFeeClaim(
  http: StonkHttp,
  mint: string,
  input: { creatorWallet: string; intentId: string; signedTransaction: string },
): Promise<FeeClaimSubmitResult> {
  if (!input.intentId) throw new StonkValidationError("intentId", "submitFeeClaim requires intentId");
  if (!input.signedTransaction) {
    throw new StonkValidationError("signedTransaction", "submitFeeClaim requires the caller-signed claim transaction");
  }
  try {
    return await http.v1Post<FeeClaimSubmitResult>(`/tokens/${mint}/fees/claim/submit`, input);
  } catch (e) {
    throw remapClaimError(e);
  }
}

/**
 * The whole claim with a caller-supplied signer: prepare → sign
 * AS-IS → submit. If submission times out on the NETWORK (not an API
 * error), safe handling is: prepare again and resubmit — the venue
 * recognizes the intent and returns the original signature with
 * alreadySubmitted: true rather than paying twice.
 */
export async function claimTokenFees(
  http: StonkHttp,
  mint: string,
  creatorWallet: string,
  sign: StonkSignTransaction,
): Promise<FeeClaimSubmitResult> {
  const prepared = await prepareFeeClaim(http, mint, creatorWallet);
  const signedTransaction = await sign(prepared.transaction);
  return submitFeeClaim(http, mint, {
    creatorWallet,
    intentId: prepared.intentId,
    signedTransaction,
  });
}
