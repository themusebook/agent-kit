import { PublicKey } from "@solana/web3.js";
import { StonkValidationError } from "./errors";
import type { StonkPair } from "./reads";

/**
 * Launch path B — build-it-yourself Raydium LaunchLab launches.
 *
 * You can skip the platform's launch API entirely and construct the
 * launch yourself against Raydium's LaunchLab program — your own mint
 * keypair, your own instructions — and still get everything the
 * platform does around a launch (token page, chart, fee ledger,
 * holder rewards), PROVIDED the pool carries the platform id and
 * matches the published launch shape exactly (the adoption checklist,
 * encoded in `validateLaunchLabAdoptionShape` below). An adopted
 * launch is indistinguishable from an API-created one.
 *
 * This module PLANS: it fetches nothing and signs nothing. It takes
 * the venue's own `GET /launchlab/pricing` response, validates every
 * number and account against it, and returns an instruction
 * descriptor the caller feeds to
 * `initializeWithToken2022` from `@raydium-io/raydium-sdk-v2`.
 *
 * ⚠️ TWO SILENT FAILURES live here (both documented by the venue,
 * both encoded as checks below):
 * 1. The transfer-fee extension parameters take the EXACT key names
 *    the Raydium SDK declares — `transferFeeBasePoints` and
 *    `maxinumFee` (sic). A key that does not match is silently
 *    ignored, leaving an extension with a ZERO rate: a mint that
 *    looks like a reward coin and taxes nobody.
 * 2. The SDK supplies the CLASSIC SPL program in the
 *    quote-token-program account (index 11). A Token-2022 quote
 *    (every xStock) needs that key substituted with the pair's
 *    `tokenProgram` before signing — read it from the pair, never
 *    assume. (Index 10, the base token program, is always Token-2022.)
 *
 * And one sizing trap: `totalFundRaisingB` is a RAW amount in the
 * quote token's decimals. Raydium's own constant is 85 SOL written in
 * lamports — pass it through on an 8-decimal xStock and you asked for
 * an 850-unit raise; on a 6-decimal stablecoin, 85,000. Always use
 * `pricing.raise.raw`, sized by the venue so the launch opens and
 * graduates where one launched through the API would. It is priced at
 * request time; re-fetch if you sat on the response.
 */

/** The Token-2022 program — the base mint of every LaunchLab launch, and account index 10. */
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
/** The classic SPL Token program — what the SDK wrongly defaults into the quote-program account. */
export const CLASSIC_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/** The `maxinumFee` (sic) value the venue's own builder uses for taxed launches. */
export const LAUNCHLAB_MAXINUM_FEE = "1000000000000000";

/**
 * Launch modes. The platform id IS the mode — pick it from the same
 * pricing response the accounts are checked against.
 * - standard — untaxed mint; creator share forwarded automatically.
 * - reward — taxed mint; the rate must be one of the published tiers.
 * - community — a reward launch whose holder payouts partly go to
 *   holders of the quote token; only where the quote offers it.
 * - standardV2 — taxed launch whose transfer fee goes to fee
 *   recipients (the creator by default); whole-bps rate inside the
 *   published range; NOT combinable with community mode.
 */
export type LaunchLabMode = "standard" | "reward" | "community" | "standardV2";

/** The `GET /launchlab/pricing?quoteMint=` response (documented fields; the venue may add more). */
export interface LaunchLabPricing {
  curve: {
    programId: string;
    configId: string;
    /** Total base supply for the curve, as an integer string. */
    supply: string;
    totalSellA: string;
    baseDecimals: number;
    cpmmCreatorFeeOn?: unknown;
    [key: string]: unknown;
  };
  raise: {
    /** THE number for totalFundRaisingB: a raw integer string in the quote token's decimals. */
    raw: string;
    [key: string]: unknown;
  };
  /** Platform id per mode. Read it on every build: it can change. */
  platform: Record<LaunchLabMode, string>;
  allowConfig: Record<LaunchLabMode, string>;
  curveRule: Record<LaunchLabMode, string>;
  modes: {
    reward: { transferFeeBps: number[]; [key: string]: unknown };
    standardV2?: { transferFeeBpsRange: { min: number; max: number }; [key: string]: unknown };
    [key: string]: unknown;
  };
  standardV2Enabled?: boolean;
  communityMode?: { offeredOnThisQuote: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

/**
 * PDA derivation, supplied by the caller — in practice the
 * `getPda*` helpers of `@raydium-io/raydium-sdk-v2`, which this kit
 * deliberately does not depend on. The planner CHECKS the derived
 * config / allow-config / curve-rule against the pricing response
 * and refuses on any mismatch ("your SDK and this API disagree").
 */
export interface LaunchLabPdaDeriver {
  launchpadAuth(programId: string): string;
  launchpadConfigId(programId: string, quoteMint: string): string;
  platformAllowConfig(programId: string, platformId: string, configId: string): string;
  platformCurveRule(programId: string, platformId: string, configId: string): string;
  launchpadPoolId(programId: string, baseMint: string, quoteMint: string): string;
  launchpadVaultId(programId: string, poolId: string, mint: string): string;
}

export interface LaunchLabAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
  role: string;
}

export interface PlanLaunchLabLaunchInput {
  pricing: LaunchLabPricing;
  /** The quote pair from GET /pairs — must be launchable AND launchLabReady. */
  pair: StonkPair;
  mode: LaunchLabMode;
  /** Transfer-fee rate for taxed modes (reward / community / standardV2). Forbidden for standard. */
  taxBps?: number;
  /** Payer + creator: the wallet creator fees are forwarded to. Fees are paid from this wallet. */
  creator: string;
  /** The NEW base mint — the caller's own freshly generated mint keypair's public key. */
  mint: string;
  name: string;
  symbol: string;
  /** Metadata URI for the new token. */
  uri: string;
  deriver: LaunchLabPdaDeriver;
}

export interface LaunchLabLaunchPlan {
  kind: "launchLabInitializeWithToken2022";
  programId: string;
  mint: string;
  quoteMint: string;
  platformId: string;
  configId: string;
  mode: LaunchLabMode;
  /**
   * The leading accounts in the SDK's initialize layout — indices
   * 0–11 (index 10 is always Token-2022; index 11 is the QUOTE
   * program read from the pair), followed by the two accounts the
   * caller MUST append LAST, both read-only: the platform
   * allow-config, then the platform curve-rule. (The SDK appends its
   * own system/rent accounts when it builds the instruction; the
   * appended pair goes after everything, as the final two keys.) An
   * initialize missing a required account fails with error 6018, and
   * one outside the published shape fails with 6025.
   */
  accounts: LaunchLabAccountMeta[];
  curve: {
    type: "ConstantCurve";
    supply: string;
    totalSellA: string;
    /** pricing.raise.raw, verbatim — never the SDK's 85-SOL constant. */
    totalFundRaisingB: string;
    migrateType: "cpmm";
  };
  baseDecimals: number;
  cpmmCreatorFeeOn?: unknown;
  /**
   * Taxed launches only. The keys are EXACTLY the names the Raydium
   * SDK declares — `transferFeeBasePoints` and `maxinumFee` (sic).
   * Any other key is silently ignored by the SDK and produces a
   * zero-rate extension.
   */
  transferFeeExtension?: { transferFeeBasePoints: number; maxinumFee: string };
  warnings: string[];
}

function assertPubkey(field: string, value: string): void {
  try {
    new PublicKey(value);
  } catch {
    throw new StonkValidationError(field, `${field} must be a valid Solana public key`);
  }
}

function validateTax(
  mode: LaunchLabMode,
  taxBps: number | undefined,
  pricing: LaunchLabPricing,
): void {
  if (mode === "standard") {
    if (taxBps !== undefined && taxBps !== 0) {
      throw new StonkValidationError(
        "taxBps",
        "standard launches are untaxed: taxBps must be 0/omitted (a taxed mint needs the reward, community or standardV2 platform id)",
      );
    }
    return;
  }
  if (taxBps === undefined) {
    throw new StonkValidationError("taxBps", `mode "${mode}" is a taxed launch: taxBps is required`);
  }
  if (mode === "reward" || mode === "community") {
    const tiers = pricing.modes.reward?.transferFeeBps ?? [];
    if (!tiers.includes(taxBps)) {
      throw new StonkValidationError(
        "taxBps",
        `taxBps ${taxBps} is not one of the published reward tiers (${tiers.join(", ") || "none published"})`,
      );
    }
  }
  if (mode === "community") {
    if (pricing.communityMode?.offeredOnThisQuote !== true) {
      throw new StonkValidationError(
        "mode",
        "Community Mode is a reward launch, offered only where pricing.communityMode.offeredOnThisQuote is true for this quote",
      );
    }
  }
  if (mode === "standardV2") {
    if (pricing.standardV2Enabled !== true) {
      throw new StonkValidationError("mode", "StandardV2 is not enabled on this deployment/quote");
    }
    const range = pricing.modes.standardV2?.transferFeeBpsRange;
    if (!Number.isInteger(taxBps)) {
      throw new StonkValidationError("taxBps", "a StandardV2 tax must be a whole number of bps");
    }
    if (range && (taxBps < range.min || taxBps > range.max)) {
      throw new StonkValidationError(
        "taxBps",
        `StandardV2 taxBps ${taxBps} is outside modes.standardV2.transferFeeBpsRange (${range.min}–${range.max})`,
      );
    }
  }
}

/**
 * Plan a BYO LaunchLab launch: validates the pair gates, the mode's
 * tax rules and every derived account against the pricing response,
 * then returns the instruction descriptor. Pure — no I/O, no signing.
 * The caller builds the real instruction with
 * `initializeWithToken2022`, checks it with
 * `validateBuiltLaunchLabInstruction`, signs with BOTH the creator
 * and the new mint keypair, and sends it themselves. Platform fee on
 * this path: none — you pay only Solana rent/fees. There is nothing
 * to submit afterwards and no paymentSignature to poll: the pool is
 * adopted within a minute or two; watch GET /tokens/{mint} for
 * launchpad: "launchlab".
 */
export function planLaunchLabLaunch(input: PlanLaunchLabLaunchInput): LaunchLabLaunchPlan {
  const { pricing, pair, mode, deriver } = input;
  const quoteMint = pair.mint;

  if (pair.launchable !== true) {
    throw new StonkValidationError(
      "pair.launchable",
      "the pair is not launchable on this platform right now (retired category/mint) — constructing against it is refused here rather than failing later",
    );
  }
  if (pair.launchLabReady !== true) {
    throw new StonkValidationError(
      "pair.launchLabReady",
      "the pair has no live LaunchLab GlobalConfig on-chain (launchLabReady is not true) — a LaunchLab launch against it fails on-chain",
    );
  }
  if (!pair.tokenProgram) {
    throw new StonkValidationError(
      "pair.tokenProgram",
      "the pair does not report its quote token program — read it from the pair, never assume classic SPL (xStocks are Token-2022)",
    );
  }
  assertPubkey("creator", input.creator);
  assertPubkey("mint", input.mint);
  assertPubkey("quoteMint", quoteMint);
  validateTax(mode, input.taxBps, pricing);

  const raiseRaw = pricing.raise?.raw;
  if (typeof raiseRaw !== "string" || !/^\d+$/.test(raiseRaw) || BigInt(raiseRaw) <= 0n) {
    throw new StonkValidationError(
      "pricing.raise.raw",
      "pricing.raise.raw must be a positive raw integer string in the quote token's decimals — it becomes totalFundRaisingB verbatim",
    );
  }

  const programId = pricing.curve.programId;
  const platformId = pricing.platform?.[mode];
  if (!platformId) {
    throw new StonkValidationError(
      "pricing.platform",
      `the pricing response carries no platform id for mode "${mode}"`,
    );
  }
  assertPubkey("pricing.curve.programId", programId);
  assertPubkey("pricing.platform", platformId);

  // Derive from the platform id taken from THIS pricing response, and
  // check every derived address against the same response. Stop on a
  // difference: your SDK and this API disagree.
  const configId = deriver.launchpadConfigId(programId, quoteMint);
  if (configId !== pricing.curve.configId) {
    throw new StonkValidationError(
      "configId",
      `derived GlobalConfig ${configId} differs from pricing.curve.configId ${pricing.curve.configId} — your SDK and this API disagree; refusing to plan`,
    );
  }
  const allowConfigId = deriver.platformAllowConfig(programId, platformId, configId);
  if (allowConfigId !== pricing.allowConfig?.[mode]) {
    throw new StonkValidationError(
      "allowConfig",
      `derived allow-config ${allowConfigId} differs from pricing.allowConfig.${mode} ${pricing.allowConfig?.[mode]} — your SDK and this API disagree; refusing to plan`,
    );
  }
  const curveRuleId = deriver.platformCurveRule(programId, platformId, configId);
  if (curveRuleId !== pricing.curveRule?.[mode]) {
    throw new StonkValidationError(
      "curveRule",
      `derived curve-rule ${curveRuleId} differs from pricing.curveRule.${mode} ${pricing.curveRule?.[mode]} — your SDK and this API disagree; refusing to plan`,
    );
  }
  const auth = deriver.launchpadAuth(programId);
  const poolId = deriver.launchpadPoolId(programId, input.mint, quoteMint);
  const baseVault = deriver.launchpadVaultId(programId, poolId, input.mint);
  const quoteVault = deriver.launchpadVaultId(programId, poolId, quoteMint);

  const accounts: LaunchLabAccountMeta[] = [
    { pubkey: input.creator, isSigner: true, isWritable: true, role: "payer" },
    { pubkey: input.creator, isSigner: true, isWritable: false, role: "creator" },
    { pubkey: configId, isSigner: false, isWritable: false, role: "globalConfig" },
    { pubkey: platformId, isSigner: false, isWritable: false, role: "platformId" },
    { pubkey: auth, isSigner: false, isWritable: false, role: "launchpadAuth" },
    { pubkey: poolId, isSigner: false, isWritable: true, role: "poolState" },
    { pubkey: input.mint, isSigner: true, isWritable: true, role: "baseMint" },
    { pubkey: quoteMint, isSigner: false, isWritable: false, role: "quoteMint" },
    { pubkey: baseVault, isSigner: false, isWritable: true, role: "baseVault" },
    { pubkey: quoteVault, isSigner: false, isWritable: true, role: "quoteVault" },
    // Index 10: the base token program — always Token-2022.
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false, role: "baseTokenProgram" },
    // Index 11: the QUOTE token program, read from the pair (the SDK
    // default of classic SPL is WRONG for Token-2022 quotes).
    { pubkey: pair.tokenProgram, isSigner: false, isWritable: false, role: "quoteTokenProgram" },
    // Appended LAST, both read-only, after the SDK's own accounts:
    { pubkey: allowConfigId, isSigner: false, isWritable: false, role: "platformAllowConfig" },
    { pubkey: curveRuleId, isSigner: false, isWritable: false, role: "platformCurveRule" },
  ];

  const warnings: string[] = [];
  if (mode !== "standard") {
    warnings.push(
      "TAXED LAUNCH: if this pool is not adopted (any adoption-checklist item off), the mint's transfer tax accrues to the platform withhold authority and is NEVER distributed to anyone. Land a standard launch first and confirm launchpad: \"launchlab\" in GET /tokens/{mint} before building a taxed one.",
    );
  }
  warnings.push(
    "Pricing is priced at request time: if you sat on this response, re-fetch GET /launchlab/pricing before signing.",
  );

  return {
    kind: "launchLabInitializeWithToken2022",
    programId,
    mint: input.mint,
    quoteMint,
    platformId,
    configId,
    mode,
    accounts,
    curve: {
      type: "ConstantCurve",
      supply: pricing.curve.supply,
      totalSellA: pricing.curve.totalSellA,
      totalFundRaisingB: raiseRaw,
      migrateType: "cpmm",
    },
    baseDecimals: pricing.curve.baseDecimals,
    ...(pricing.curve.cpmmCreatorFeeOn !== undefined
      ? { cpmmCreatorFeeOn: pricing.curve.cpmmCreatorFeeOn }
      : {}),
    ...(mode !== "standard"
      ? {
          transferFeeExtension: {
            transferFeeBasePoints: input.taxBps!,
            maxinumFee: LAUNCHLAB_MAXINUM_FEE,
          },
        }
      : {}),
    warnings,
  };
}

/**
 * Check a BUILT initialize instruction's keys against the two
 * documented layout traps + the appended accounts. Returns problems;
 * empty means the layout matches the venue's published shape.
 */
export function validateBuiltLaunchLabInstruction(
  keys: Array<{ pubkey: string; isWritable?: boolean }>,
  ctx: { pair: StonkPair; allowConfigId: string; curveRuleId: string },
): string[] {
  const problems: string[] = [];
  if (keys.length < 12) {
    problems.push(`instruction has ${keys.length} keys — the documented layout needs at least 12`);
    return problems;
  }
  if (keys[10]!.pubkey !== TOKEN_2022_PROGRAM_ID) {
    problems.push(
      `account 10 must be the Token-2022 program (${TOKEN_2022_PROGRAM_ID}), got ${keys[10]!.pubkey} — layout changed`,
    );
  }
  if (ctx.pair.tokenProgram && keys[11]!.pubkey !== ctx.pair.tokenProgram) {
    problems.push(
      `account 11 must be the quote token program from the pair (${ctx.pair.tokenProgram}), got ${keys[11]!.pubkey} — the SDK defaults to classic SPL, which is wrong for Token-2022 quotes; substitute before signing`,
    );
  }
  const last = keys[keys.length - 1];
  const secondLast = keys[keys.length - 2];
  if (!secondLast || secondLast.pubkey !== ctx.allowConfigId || secondLast.isWritable) {
    problems.push(
      "the platform allow-config account must be appended as the second-to-last key, read-only (missing account → error 6018)",
    );
  }
  if (!last || last.pubkey !== ctx.curveRuleId || last.isWritable) {
    problems.push(
      "the platform curve-rule account must be appended as the LAST key, read-only (missing account → error 6018)",
    );
  }
  return problems;
}

/** A launch as built, checked against the venue's adoption checklist. */
export interface LaunchLabAdoptionShape {
  /** The GlobalConfig the initialize used. */
  globalConfigId: string;
  /** Curve kind — adoption requires the constant-product curve. */
  curveKind: "constant-product" | string;
  migrateType: string;
  supply: string;
  totalSellA: string;
  totalFundRaisingB: string;
  /** Base mint decimals — every LaunchLab launch is 6. */
  baseMintDecimals: number;
  /** How the base mint was created — adoption requires initialize_with_token2022. */
  baseMintCreatedVia: "initialize_with_token2022" | string;
  /** The mint's transfer-fee rate, or null/undefined for no extension. The extension IS the mode. */
  transferFeeBps?: number | null;
  platformId: string;
  mode: LaunchLabMode;
  /** The platform curve-rule account was appended (last, read-only). */
  hasCurveRuleAccount: boolean;
}

/**
 * THE ADOPTION CHECKLIST, as a pure function. Attribution (carrying
 * the platform id) is necessary but not sufficient: a pool is adopted
 * only if it matches the launch the venue's own builder would have
 * produced — everything below comes straight out of the pricing
 * response, so matching it is a matter of not substituting your own
 * values. A pool that misses any item still exists and trades on
 * Raydium — the platform simply never records it (for a standard
 * launch: no fee forwarding; for a taxed one: the tax accrues to
 * nobody). Returns problems; empty means adoptable.
 */
export function validateLaunchLabAdoptionShape(
  shape: LaunchLabAdoptionShape,
  pricing: LaunchLabPricing,
): string[] {
  const problems: string[] = [];
  if (shape.globalConfigId !== pricing.curve.configId) {
    problems.push("globalConfig must be pricing.curve.configId");
  }
  if (shape.curveKind !== "constant-product") {
    problems.push("curve must be constant-product");
  }
  if (shape.migrateType !== "cpmm") {
    problems.push('migrateType must be "cpmm"');
  }
  if (shape.supply !== pricing.curve.supply) {
    problems.push("supply must equal pricing.curve.supply (it fixes the open-to-graduation run)");
  }
  if (shape.totalSellA !== pricing.curve.totalSellA) {
    problems.push("totalSellA must equal pricing.curve.totalSellA");
  }
  if (!/^\d+$/.test(shape.totalFundRaisingB) || BigInt(shape.totalFundRaisingB) <= 0n) {
    problems.push("totalFundRaisingB must be a positive raw amount (use pricing.raise.raw)");
  }
  if (shape.baseMintDecimals !== 6) {
    problems.push("base mint must be created at 6 decimals");
  }
  if (shape.baseMintCreatedVia !== "initialize_with_token2022") {
    problems.push("base mint must be created by initialize_with_token2022");
  }
  const expectedPlatform = pricing.platform?.[shape.mode];
  if (expectedPlatform && shape.platformId !== expectedPlatform) {
    problems.push(`platform id must be pricing.platform.${shape.mode} (the platform id IS the mode)`);
  }
  if (shape.mode === "standard") {
    if (shape.transferFeeBps !== undefined && shape.transferFeeBps !== null && shape.transferFeeBps !== 0) {
      problems.push("a standard launch carries NO transfer-fee extension");
    }
  } else {
    const tiers = pricing.modes.reward?.transferFeeBps ?? [];
    if (shape.transferFeeBps === undefined || shape.transferFeeBps === null) {
      problems.push(`mode "${shape.mode}" requires a transfer-fee extension at a published rate`);
    } else if (
      (shape.mode === "reward" || shape.mode === "community") &&
      !tiers.includes(shape.transferFeeBps)
    ) {
      problems.push(
        `transfer-fee rate ${shape.transferFeeBps} is not a published tier (${tiers.join(", ")}) — read off the mint, an unpublished rate is never adopted`,
      );
    }
  }
  if (!shape.hasCurveRuleAccount) {
    problems.push(
      "the platform curve-rule account must be appended as the LAST account of the initialize, read-only",
    );
  }
  return problems;
}
