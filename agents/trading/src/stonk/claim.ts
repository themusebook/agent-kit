import { HttpError, type StonkClient } from "./client.ts";

export type ClaimPlan =
  | { status: "ready"; mint: string; creatorWallet: string; intentId: string; transaction: string; expiresInSeconds: 90; scope: string | null; claimable: unknown }
  | { status: "skipped"; mint: string; reason: string };

/**
 * GET fees -> POST claim/prepare. Returns the unsigned claim tx for the user's
 * wallet. A "creator-quote-vault" balance covers every launch the creator has
 * against that quote, so it is claimed once per quote: `claimedQuotes` carries
 * the quotes already claimed in this run.
 */
export async function planClaim(
  client: StonkClient,
  mint: string,
  creatorWallet: string,
  claimedQuotes: Set<string> = new Set(),
): Promise<ClaimPlan> {
  const fees = await client.fees(mint);
  if (fees?.claimable == null) return { status: "skipped", mint, reason: fees?.reason ?? "nothing claimable" };
  const scope: string | null = fees.scope ?? fees.claimable?.scope ?? null;
  const quote: string | undefined = fees.quoteMint ?? fees.claimable?.quoteMint ?? fees.quote?.mint;
  if (scope === "creator-quote-vault" && quote) {
    if (claimedQuotes.has(quote)) return { status: "skipped", mint, reason: `creator-quote-vault for ${quote} already claimed in this run` };
  }
  try {
    const p = await client.prepareClaim(mint, creatorWallet);
    if (scope === "creator-quote-vault" && quote) claimedQuotes.add(quote);
    return { status: "ready", mint, creatorWallet, intentId: p.intentId, transaction: p.transaction, expiresInSeconds: 90, scope, claimable: fees.claimable };
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) return { status: "skipped", mint, reason: "403: this wallet has no creator fee position on this token" };
    if (e instanceof HttpError && e.status === 409) return { status: "skipped", mint, reason: "409: nothing to claim yet" };
    throw e;
  }
}

/** Relay a claim the user signed. A retry after a timeout returns alreadySubmitted. */
export async function submitSignedClaim(
  client: StonkClient,
  mint: string,
  body: { creatorWallet: string; intentId: string; signedTransaction: string },
) {
  const r = await client.submitClaim(mint, body);
  return { signature: r.signature, alreadySubmitted: r.alreadySubmitted === true };
}
