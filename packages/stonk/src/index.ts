export * from "./errors";
export * from "./paginate";
export * from "./reads";
export * from "./launchlab";
export * from "./launch";
export * from "./claims";
export {
  STONK_V1_BASE,
  STONK_V2_BASE,
  StonkHttp,
  buildQuery,
  type StonkClientConfig,
  type StonkSignTransaction,
} from "./client";

import { StonkHttp, type StonkClientConfig, type StonkSignTransaction } from "./client";
import { paginateV2, type V2Page } from "./paginate";
import {
  availableLaunchPaths,
  chooseLaunchPath,
  getStats,
  getToken,
  getTokenAirdrop,
  getTokenBacking,
  getTokenBurns,
  getTokenRewardFeeRecipients,
  getTokenRewardHolders,
  getTokenRewardPayouts,
  getTokenRewards,
  getTokenRewardsPending,
  getTokenSocials,
  getLaunchV2,
  listLaunches,
  listPairs,
  listRecentLaunchesV2,
  listRewardLaunchesV2,
  listRewardPayoutsV2,
  listTokens,
  type ListLaunchesParams,
  type ListPairsParams,
  type ListTokensParams,
  type StonkLaunchPath,
  type StonkLaunchRecord,
  type StonkPair,
  type StonkRewardsTotals,
  type StonkStats,
  type StonkToken,
} from "./reads";
import {
  getApiLaunchByPayment,
  getLaunchLabPricing,
  prepareApiLaunch,
  signAndSubmitApiLaunch,
  submitApiLaunch,
  waitForApiLaunch,
  type ApiLaunchPrepareInput,
  type ApiLaunchPrepared,
  type ApiLaunchStatus,
  type ApiLaunchSubmitResult,
} from "./launch";
import type { LaunchLabPricing } from "./launchlab";
import {
  claimTokenFees,
  getTokenFees,
  prepareFeeClaim,
  submitFeeClaim,
  type FeeClaimPrepared,
  type FeeClaimSubmitResult,
  type StonkTokenFees,
} from "./claims";
import type { V2ListParams } from "./paginate";

/**
 * The Stonkfun client. Construct with `createStonkClient()` (an
 * optional fetchImpl / base overrides — tests inject a mock fetch).
 * Non-custodial throughout: signing is always a caller-supplied
 * callback, and nothing here broadcasts a transaction the caller did
 * not sign.
 */
export interface StonkClient {
  readonly http: StonkHttp;
  /** Rate-limit snapshot (X-RateLimit-*) from the most recent response. */
  readonly rateLimit: StonkHttp["rateLimit"];

  // ---- stats / path selection
  getStats(): Promise<StonkStats>;
  availableLaunchPaths(stats: StonkStats): StonkLaunchPath[];
  chooseLaunchPath(stats: StonkStats, preference?: StonkLaunchPath): StonkLaunchPath;

  // ---- v1 reads
  listTokens(params?: ListTokensParams): Promise<StonkToken[]>;
  getToken(mint: string): Promise<StonkToken>;
  getTokenBurns(mint: string, params?: { limit?: number }): Promise<unknown>;
  getTokenAirdrop(mint: string): Promise<unknown>;
  getTokenBacking(mint: string): Promise<unknown>;
  listLaunches(params?: ListLaunchesParams): Promise<StonkLaunchRecord[]>;
  listPairs(params?: ListPairsParams): Promise<StonkPair[]>;

  // ---- v2 reads (server-side only — no CORS)
  listRecentLaunches(params?: V2ListParams & { windowMs?: number }): Promise<V2Page<Record<string, unknown>>>;
  getLaunch(mint: string): Promise<Record<string, unknown> | null>;
  getTokenSocials(mint: string): Promise<{ website?: string; twitter?: string; telegram?: string }>;
  getTokenRewards(mint: string): Promise<StonkRewardsTotals>;
  getTokenRewardHolders(mint: string): Promise<StonkRewardsTotals>;
  getTokenRewardFeeRecipients(mint: string, params?: V2ListParams): Promise<V2Page<Record<string, unknown>>>;
  getTokenRewardsPending(mint: string): Promise<Record<string, unknown>>;
  getTokenRewardPayouts(mint: string, params?: V2ListParams): Promise<V2Page<Record<string, unknown>>>;
  listRewardLaunches(params?: V2ListParams & { asset?: "quote" | "base"; sort?: "distributed" | "recent" }): Promise<V2Page<Record<string, unknown>>>;
  listRewardPayouts(params?: V2ListParams & { asset?: "quote" | "base" }): Promise<V2Page<Record<string, unknown>>>;
  /** Stream EVERY recent launch across v2 pages (cursor-followed; only nextCursor: null ends). */
  iterateRecentLaunches(params?: V2ListParams & { windowMs?: number }): AsyncGenerator<Record<string, unknown>, void, undefined>;
  /** Stream EVERY reward payout across v2 pages. */
  iterateRewardPayouts(params?: V2ListParams & { asset?: "quote" | "base" }): AsyncGenerator<Record<string, unknown>, void, undefined>;

  // ---- launch path A (API-built)
  prepareLaunch(input: ApiLaunchPrepareInput): Promise<ApiLaunchPrepared>;
  submitLaunch(input: { signedTransaction: string; paymentSignature?: string; [key: string]: unknown }): Promise<ApiLaunchSubmitResult>;
  signAndSubmitLaunch(input: ApiLaunchPrepareInput, sign: StonkSignTransaction): Promise<ApiLaunchSubmitResult>;
  getLaunchByPayment(paymentSignature: string): Promise<ApiLaunchStatus>;
  waitForLaunch(paymentSignature: string, opts?: { intervalMs?: number; maxAttempts?: number; sleep?: (ms: number) => Promise<void> }): Promise<ApiLaunchStatus>;

  // ---- launch path B (BYO LaunchLab) — pricing fetch; planning lives in launchlab.ts (pure)
  getLaunchLabPricing(quoteMint: string): Promise<LaunchLabPricing>;

  // ---- fee claims
  getTokenFees(mint: string): Promise<StonkTokenFees>;
  prepareFeeClaim(mint: string, creatorWallet: string): Promise<FeeClaimPrepared>;
  submitFeeClaim(mint: string, input: { creatorWallet: string; intentId: string; signedTransaction: string }): Promise<FeeClaimSubmitResult>;
  claimTokenFees(mint: string, creatorWallet: string, sign: StonkSignTransaction): Promise<FeeClaimSubmitResult>;
}

export function createStonkClient(config: StonkClientConfig = {}): StonkClient {
  const http = new StonkHttp(config);
  return {
    http,
    get rateLimit() {
      return http.rateLimit;
    },

    getStats: () => getStats(http),
    availableLaunchPaths,
    chooseLaunchPath,

    listTokens: (params) => listTokens(http, params),
    getToken: (mint) => getToken(http, mint),
    getTokenBurns: (mint, params) => getTokenBurns(http, mint, params),
    getTokenAirdrop: (mint) => getTokenAirdrop(http, mint),
    getTokenBacking: (mint) => getTokenBacking(http, mint),
    listLaunches: (params) => listLaunches(http, params),
    listPairs: (params) => listPairs(http, params),

    listRecentLaunches: (params) => listRecentLaunchesV2(http, params),
    getLaunch: (mint) => getLaunchV2(http, mint),
    getTokenSocials: (mint) => getTokenSocials(http, mint),
    getTokenRewards: (mint) => getTokenRewards(http, mint),
    getTokenRewardHolders: (mint) => getTokenRewardHolders(http, mint),
    getTokenRewardFeeRecipients: (mint, params) => getTokenRewardFeeRecipients(http, mint, params),
    getTokenRewardsPending: (mint) => getTokenRewardsPending(http, mint),
    getTokenRewardPayouts: (mint, params) => getTokenRewardPayouts(http, mint, params),
    listRewardLaunches: (params) => listRewardLaunchesV2(http, params),
    listRewardPayouts: (params) => listRewardPayoutsV2(http, params),
    iterateRecentLaunches: (params) =>
      (async function* () {
        const { windowMs, ...rest } = params ?? {};
        yield* paginateV2((cursor) =>
          listRecentLaunchesV2(http, { ...rest, ...(windowMs !== undefined ? { windowMs } : {}), cursor }),
        );
      })(),
    iterateRewardPayouts: (params) =>
      (async function* () {
        yield* paginateV2((cursor) => listRewardPayoutsV2(http, { ...(params ?? {}), cursor }));
      })(),

    prepareLaunch: (input) => prepareApiLaunch(http, input),
    submitLaunch: (input) => submitApiLaunch(http, input),
    signAndSubmitLaunch: (input, sign) => signAndSubmitApiLaunch(http, input, sign),
    getLaunchByPayment: (sig) => getApiLaunchByPayment(http, sig),
    waitForLaunch: (sig, opts) => waitForApiLaunch(http, sig, opts),

    getLaunchLabPricing: (quoteMint) => getLaunchLabPricing(http, quoteMint),

    getTokenFees: (mint) => getTokenFees(http, mint),
    prepareFeeClaim: (mint, wallet) => prepareFeeClaim(http, mint, wallet),
    submitFeeClaim: (mint, input) => submitFeeClaim(http, mint, input),
    claimTokenFees: (mint, wallet, sign) => claimTokenFees(http, mint, wallet, sign),
  };
}
