import { buildQuery, type StonkHttp } from "./client";
import type { V2ListParams, V2Page, V2PageInfo } from "./paginate";

/**
 * Read surface of the Stonkfun Developer API. All reads are open (no
 * key); v1 reads are paged by page/pageSize, v2 reads by cursor (see
 * paginate.ts). Use v2 where a v2 endpoint exists.
 *
 * Token objects are typed for the documented fields and tolerate the
 * rest (`[key: string]: unknown`) — the venue adds fields over time
 * (transferFee, communityMode, feeRecipients, flywheel, …).
 */

export interface StonkToken {
  mint: string;
  name?: string;
  symbol?: string;
  /** Present when the platform launched (or adopted) the token — "launchlab" for LaunchLab launches. */
  launchpad?: string;
  mode?: "standard" | "reward" | string;
  status?: "new" | "aboutToGraduate" | "graduated" | string;
  /** V3 reward tokens: the Token-2022 transfer tax paid to holders. Use the Token-2022 program for their accounts. */
  transferFee?: { bps: number };
  /** Community Mode tokens: the share of every holder payout that goes to holders of the quote token instead. */
  communityMode?: { shareBps: number };
  /** StandardV2 tokens: the share of the transfer tax paid to the fee recipients set at launch. */
  feeRecipients?: { shareBps: number };
  /** Present while the token is in the buyback rankings. */
  flywheel?: { active: boolean };
  [key: string]: unknown;
}

export interface ListTokensParams {
  /** Search name, symbol or mint. */
  q?: string;
  sort?: "marketCap" | "newest" | "volume";
  mode?: "standard" | "reward";
  status?: "new" | "aboutToGraduate" | "graduated";
  quoteMint?: string;
  category?: string;
  page?: number;
  /** 1–100, default 25. */
  pageSize?: number;
}

export interface StonkLaunchRecord {
  mint?: string;
  creator?: string;
  mode?: "standard" | "reward" | string;
  /** "launchlab" marks launches built directly against the venue (adopted), not only API-created ones. */
  launchpad?: string;
  [key: string]: unknown;
}

export interface ListLaunchesParams {
  /** Filter by creator wallet — find your own launches. */
  creator?: string;
  mode?: "standard" | "reward";
  /** ISO 8601; only launches at or after this time. */
  since?: string;
  page?: number;
  pageSize?: number;
}

/**
 * A quote token a new launch can pair against. Two DIFFERENT gates:
 * `launchable` is the platform's own rule (retired categories/mints
 * are false); `launchLabReady` says whether Raydium has created the
 * on-chain GlobalConfig a LaunchLab launch needs. A pair can be
 * launchable but not LaunchLab-ready — constructing a launch against
 * one of those fails on-chain.
 */
export interface StonkPair {
  /** The quote mint. */
  mint: string;
  symbol?: string;
  category?: string;
  launchable?: boolean;
  /** Absent (not false) when the venue is off or the probe could not run. */
  launchLabReady?: boolean;
  communityMode?: boolean;
  standardV2Enabled?: boolean;
  /** The program owning the QUOTE mint — every xStock is Token-2022; read it, never assume classic SPL. */
  tokenProgram?: string;
  [key: string]: unknown;
}

export interface ListPairsParams {
  category?: string;
  launchable?: boolean;
  launchLabReady?: boolean;
  communityMode?: boolean;
}

export interface StonkStats {
  config: {
    /** The two-call /launches API flow is live. */
    paidLaunchesEnabled: boolean;
    /** The build-it-yourself LaunchLab path is live. */
    launchLabEnabled: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Which launch paths the venue currently has live. Read this BEFORE choosing a path. */
export type StonkLaunchPath = "api" | "launchlab";

export function availableLaunchPaths(stats: StonkStats): StonkLaunchPath[] {
  const paths: StonkLaunchPath[] = [];
  if (stats.config.paidLaunchesEnabled) paths.push("api");
  if (stats.config.launchLabEnabled) paths.push("launchlab");
  return paths;
}

export function chooseLaunchPath(
  stats: StonkStats,
  preference: StonkLaunchPath = "api",
): StonkLaunchPath {
  const available = availableLaunchPaths(stats);
  if (available.includes(preference)) return preference;
  const fallback = available[0];
  if (!fallback) {
    throw new Error(
      "Stonkfun stats report BOTH launch paths disabled (paidLaunchesEnabled and launchLabEnabled are false) — no launch is possible right now.",
    );
  }
  return fallback;
}

// ---------------------------------------------------------------- v1

export async function listTokens(
  http: StonkHttp,
  params: ListTokensParams = {},
): Promise<StonkToken[]> {
  const body = await http.v1Get<{ tokens?: StonkToken[] } | StonkToken[]>(
    `/tokens${buildQuery({ ...params })}`,
  );
  return Array.isArray(body) ? body : (body.tokens ?? []);
}

export async function getToken(http: StonkHttp, mint: string): Promise<StonkToken> {
  return http.v1Get<StonkToken>(`/tokens/${mint}`);
}

export async function getTokenBurns(
  http: StonkHttp,
  mint: string,
  params: { limit?: number } = {},
): Promise<unknown> {
  return http.v1Get(`/tokens/${mint}/burns${buildQuery({ ...params })}`);
}

/** The airdrop a token launched with, if any — `airdrop: null` is a normal answer, not an error. */
export async function getTokenAirdrop(http: StonkHttp, mint: string): Promise<unknown> {
  return http.v1Get(`/tokens/${mint}/airdrop`);
}

/**
 * USD permanently locked behind a token. PUMP LAUNCHES ONLY: every
 * other launch (Raydium CLMM and LaunchLab alike) answers 400
 * invalid_request rather than a zero — check `launchpad` from
 * getToken before calling.
 */
export async function getTokenBacking(http: StonkHttp, mint: string): Promise<unknown> {
  return http.v1Get(`/tokens/${mint}/backing`);
}

export async function listLaunches(
  http: StonkHttp,
  params: ListLaunchesParams = {},
): Promise<StonkLaunchRecord[]> {
  const body = await http.v1Get<{ launches?: StonkLaunchRecord[] } | StonkLaunchRecord[]>(
    `/launches${buildQuery({ ...params })}`,
  );
  return Array.isArray(body) ? body : (body.launches ?? []);
}

export async function listPairs(
  http: StonkHttp,
  params: ListPairsParams = {},
): Promise<StonkPair[]> {
  const body = await http.v1Get<{ pairs: StonkPair[] }>(`/pairs${buildQuery({ ...params })}`);
  return body.pairs ?? [];
}

export async function getStats(http: StonkHttp): Promise<StonkStats> {
  return http.v1Get<StonkStats>(`/stats`);
}

// ---------------------------------------------------------------- v2

function pageOf<T>(body: { page?: V2PageInfo }, items: T[]): V2Page<T> {
  return {
    items,
    page: body.page ?? { limit: items.length, order: "desc", nextCursor: null },
  };
}

/** Launches from the last windowMs (10 minutes), read from the launch records. Each pool has pending: true. */
export async function listRecentLaunchesV2(
  http: StonkHttp,
  params: V2ListParams & { windowMs?: number } = {},
): Promise<V2Page<Record<string, unknown>>> {
  const body = await http.v2Get<{ pools?: Record<string, unknown>[]; page?: V2PageInfo }>(
    `/launches/recent${buildQuery({ ...params })}`,
  );
  return pageOf(body, body.pools ?? []);
}

/** The launch record for a mint, in the pool shape. Answers pool: null when the platform did not launch the mint. */
export async function getLaunchV2(
  http: StonkHttp,
  mint: string,
): Promise<Record<string, unknown> | null> {
  const body = await http.v2Get<{ pool?: Record<string, unknown> | null }>(`/launches/${mint}`);
  return body.pool ?? null;
}

/** Website / twitter / telegram of a token. Each key is absent when the token has no such link. */
export async function getTokenSocials(
  http: StonkHttp,
  mint: string,
): Promise<{ website?: string; twitter?: string; telegram?: string }> {
  return http.v2Get(`/tokens/${mint}/socials`);
}

export interface StonkRewardsTotals {
  mint: string;
  mode?: string;
  /** "ledger" | "snapshot" | "awaiting-snapshot" | "awaiting-ledger" — awaiting-* means totals not built yet, rewards null: retry in ~1 minute. */
  basis?: string;
  rewards: Record<string, unknown> | null;
  base: Record<string, unknown> | null;
  [key: string]: unknown;
}

export async function getTokenRewards(
  http: StonkHttp,
  mint: string,
): Promise<StonkRewardsTotals> {
  return http.v2Get<StonkRewardsTotals>(`/tokens/${mint}/rewards`);
}

export async function getTokenRewardHolders(
  http: StonkHttp,
  mint: string,
): Promise<StonkRewardsTotals> {
  return http.v2Get<StonkRewardsTotals>(`/tokens/${mint}/rewards/holders`);
}

export async function getTokenRewardFeeRecipients(
  http: StonkHttp,
  mint: string,
  params: V2ListParams = {},
): Promise<V2Page<Record<string, unknown>>> {
  const body = await http.v2Get<{ rows?: Record<string, unknown>[]; page?: V2PageInfo }>(
    `/tokens/${mint}/rewards/fee-recipients${buildQuery({ ...params })}`,
  );
  return pageOf(body, body.rows ?? []);
}

/** What holders are owed and have not received: undistributed + queued + inFlight (stranded waits for an admin). */
export async function getTokenRewardsPending(
  http: StonkHttp,
  mint: string,
): Promise<Record<string, unknown>> {
  return http.v2Get(`/tokens/${mint}/rewards/pending`);
}

export async function getTokenRewardPayouts(
  http: StonkHttp,
  mint: string,
  params: V2ListParams = {},
): Promise<V2Page<Record<string, unknown>>> {
  const body = await http.v2Get<{ rows?: Record<string, unknown>[]; page?: V2PageInfo }>(
    `/tokens/${mint}/rewards/payouts${buildQuery({ ...params })}`,
  );
  return pageOf(body, body.rows ?? []);
}

export async function listRewardLaunchesV2(
  http: StonkHttp,
  params: V2ListParams & { asset?: "quote" | "base"; sort?: "distributed" | "recent" } = {},
): Promise<V2Page<Record<string, unknown>>> {
  const body = await http.v2Get<{ rows?: Record<string, unknown>[]; page?: V2PageInfo }>(
    `/rewards/launches${buildQuery({ ...params })}`,
  );
  return pageOf(body, body.rows ?? []);
}

export async function listRewardPayoutsV2(
  http: StonkHttp,
  params: V2ListParams & { asset?: "quote" | "base" } = {},
): Promise<V2Page<Record<string, unknown>>> {
  const body = await http.v2Get<{ rows?: Record<string, unknown>[]; page?: V2PageInfo }>(
    `/rewards/payouts${buildQuery({ ...params })}`,
  );
  return pageOf(body, body.rows ?? []);
}
