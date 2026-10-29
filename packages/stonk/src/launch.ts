import { buildQuery, type StonkHttp, type StonkSignTransaction } from "./client";
import { StonkValidationError } from "./errors";
import type { LaunchLabPricing } from "./launchlab";

/**
 * Launch path A — the platform builds the launch, in two calls.
 *
 * `prepareLaunch` asks for a launch; the response carries the
 * transaction for the launch fee payment (the API-built path may
 * charge a launch fee — path B, BYO LaunchLab, never does). The
 * CALLER signs it — there is no API key; your signature on the fee
 * payment IS the authorization to launch. `submitLaunch` hands the
 * signed transaction back; the platform builds the pool, and the
 * launch completes asynchronously — poll `getApiLaunchByPayment` with
 * the payment's signature until the status leaves `processing`.
 *
 * NEVER PAY TWICE for the same launch: the payment signature
 * identifies the launch, and re-submitting the same payment cannot
 * launch a second token. If a signed payment's status is unclear,
 * poll — do not prepare a second one.
 *
 * On a standard launch the creator's seat is a Token-2022 position
 * NFT (supply 1, decimals 0 — the "Fee Key NFT") minted to the
 * creator in the same launch; creator fees accrue to whoever holds
 * that NFT, and are claimed through the fee-claim flow (claims.ts).
 */

export interface ApiLaunchPrepareInput {
  /** Creator wallet — receives the position / Fee Key NFT and the creator fees. */
  creatorWallet: string;
  /** Mode and launch parameters (name, symbol, metadata, quote, …) per the API contract. */
  [key: string]: unknown;
}

export interface ApiLaunchPrepared {
  /** The fee-payment transaction (base64) for the caller to sign. */
  transaction: string;
  /** The payment's signature once signed — the launch's identity for polling. */
  paymentSignature?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface ApiLaunchSubmitResult {
  paymentSignature?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ApiLaunchStatus {
  /** "processing" while the platform builds the pool; terminal states carry the mint. */
  status: string;
  mint?: string;
  [key: string]: unknown;
}

/** POST /launches/prepare — the venue answers a transaction for the fee payment (rate limit: 25/min). */
export async function prepareApiLaunch(
  http: StonkHttp,
  input: ApiLaunchPrepareInput,
): Promise<ApiLaunchPrepared> {
  if (!input.creatorWallet) {
    throw new StonkValidationError("creatorWallet", "prepareApiLaunch requires creatorWallet");
  }
  return http.v1Post<ApiLaunchPrepared>("/launches/prepare", input);
}

/** POST /launches/submit — idempotent by payment signature: re-submitting the same payment cannot double-launch. */
export async function submitApiLaunch(
  http: StonkHttp,
  input: { signedTransaction: string; paymentSignature?: string; [key: string]: unknown },
): Promise<ApiLaunchSubmitResult> {
  if (!input.signedTransaction) {
    throw new StonkValidationError("signedTransaction", "submitApiLaunch requires the caller-signed fee payment transaction");
  }
  return http.v1Post<ApiLaunchSubmitResult>("/launches/submit", input);
}

/**
 * Full path A with a caller-supplied signer: prepare → sign (the key
 * never leaves the caller) → submit. Returns the submission; poll
 * with waitForApiLaunch. If anything fails AFTER the payment was
 * signed, do not prepare again — the payment signature already
 * identifies this launch.
 */
export async function signAndSubmitApiLaunch(
  http: StonkHttp,
  input: ApiLaunchPrepareInput,
  sign: StonkSignTransaction,
): Promise<ApiLaunchSubmitResult> {
  const prepared = await prepareApiLaunch(http, input);
  const signedTransaction = await sign(prepared.transaction);
  return submitApiLaunch(http, {
    signedTransaction,
    ...(prepared.paymentSignature ? { paymentSignature: prepared.paymentSignature } : {}),
  });
}

/** GET /launches/{paymentSignature} — the launch, keyed by the fee payment's signature. */
export async function getApiLaunchByPayment(
  http: StonkHttp,
  paymentSignature: string,
): Promise<ApiLaunchStatus> {
  return http.v1Get<ApiLaunchStatus>(`/launches/${paymentSignature}`);
}

/**
 * Poll a submitted launch until it leaves `processing`. Pure polling
 * — this never prepares or pays again. Resolves with the last status
 * seen; check `status`/`mint` on the result (and keep polling
 * yourself if it is still processing after maxAttempts).
 */
export async function waitForApiLaunch(
  http: StonkHttp,
  paymentSignature: string,
  opts: {
    intervalMs?: number;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ApiLaunchStatus> {
  const intervalMs = opts.intervalMs ?? 5000;
  const maxAttempts = opts.maxAttempts ?? 24;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: ApiLaunchStatus | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    last = await getApiLaunchByPayment(http, paymentSignature);
    if (last.status !== "processing") return last;
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }
  if (!last) throw new StonkValidationError("paymentSignature", "waitForApiLaunch made no poll");
  return last;
}

/**
 * GET /launchlab/pricing?quoteMint= — the numbers every BYO LaunchLab
 * launch is built (and adopted) against. Priced at request time;
 * re-fetch if you sat on the response. See launchlab.ts for the
 * planner that consumes this.
 */
export async function getLaunchLabPricing(
  http: StonkHttp,
  quoteMint: string,
): Promise<LaunchLabPricing> {
  return http.v1Get<LaunchLabPricing>(`/launchlab/pricing${buildQuery({ quoteMint })}`);
}
