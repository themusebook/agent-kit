import BN from "bn.js";
import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  getPdaLaunchpadAuth,
  getPdaLaunchpadConfigId,
  getPdaLaunchpadPoolId,
  getPdaLaunchpadVaultId,
  getPdaPlatformAllowConfig,
  getPdaPlatformCurveRule,
  initializeWithToken2022,
} from "@raydium-io/raydium-sdk-v2";

export type LaunchMode = "standard" | "reward" | "community" | "standardV2";

export class LaunchGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaunchGuardError";
  }
}

export interface LaunchLabInput {
  payer: PublicKey;
  creator: PublicKey;
  mint: PublicKey;
  pair: { mint: string; tokenProgram: string; launchLabReady?: boolean; launchable?: boolean };
  pricing: any;
  mode: LaunchMode;
  name: string;
  symbol: string;
  uri: string;
  transferFeeBps?: number;
  /** For a taxed launch: the mint of an earlier standard launch confirmed as launchpad "launchlab". */
  confirmedStandardLaunch?: { mint: string; launchpad: string };
}

const pk = (v: unknown, what: string) => {
  if (typeof v !== "string" || !v) throw new LaunchGuardError(`pricing is missing ${what}`);
  return new PublicKey(v);
};

const eq = (a: PublicKey, b: PublicKey, what: string) => {
  if (!a.equals(b)) throw new LaunchGuardError(`${what} mismatch: derived ${a.toBase58()} but pricing says ${b.toBase58()}`);
};

/** Validate the holder-tax tier for the mode against what this platform publishes. */
export function checkTax(pricing: any, mode: LaunchMode, bps: number | undefined): void {
  if (mode === "standard") {
    if (bps) throw new LaunchGuardError("a standard launch carries no transfer fee");
    return;
  }
  if (mode === "community" && pricing?.communityMode?.offeredOnThisQuote !== true) {
    throw new LaunchGuardError("Community Mode is not offered on this quote (communityMode.offeredOnThisQuote)");
  }
  if (mode === "standardV2") {
    if (pricing?.standardV2Enabled !== true) throw new LaunchGuardError("StandardV2 is not enabled on this deployment");
    const r = pricing?.modes?.standardV2?.transferFeeBpsRange;
    if (!Array.isArray(r) || r.length !== 2) throw new LaunchGuardError("pricing has no modes.standardV2.transferFeeBpsRange");
    if (bps === undefined || bps < r[0] || bps > r[1]) throw new LaunchGuardError(`standardV2 transferFeeBps ${bps} outside ${r[0]}..${r[1]}`);
    return;
  }
  const tiers = pricing?.modes?.reward?.transferFeeBps;
  if (!Array.isArray(tiers)) throw new LaunchGuardError("pricing has no modes.reward.transferFeeBps tiers");
  if (bps === undefined || !tiers.includes(bps)) throw new LaunchGuardError(`transferFeeBps ${bps} is not a published tier (${tiers.join(", ")})`);
}

/** Exact Raydium SDK keys, including its `maxinumFee` spelling. */
export function transferFeeParams(bps: number): { transferFeeBasePoints: number; maxinumFee: BN } {
  return { transferFeeBasePoints: bps, maxinumFee: new BN("18446744073709551615") };
}

const platformKey = (mode: LaunchMode) => (mode === "standardV2" ? "standardV2" : mode);

/**
 * Build the LaunchLab create (initializeWithToken2022) for the build-it-yourself path.
 * Every account the platform publishes is re-derived and must match.
 */
export function buildLaunchLabInstructions(input: LaunchLabInput): { instructions: TransactionInstruction[]; derived: Record<string, string> } {
  const { pricing: p, mode, pair } = input;
  if (pair.launchLabReady === false) throw new LaunchGuardError("pair is not launchLabReady");
  if (pair.launchable === false) throw new LaunchGuardError("pair is not launchable");
  if (p?.quote?.mint && p.quote.mint !== pair.mint) throw new LaunchGuardError("pricing quote differs from the pair");
  if (mode !== "standard") {
    const c = input.confirmedStandardLaunch;
    if (!c || c.launchpad !== "launchlab") throw new LaunchGuardError('land a standard launch first and confirm GET /tokens/{mint} shows launchpad "launchlab" before any taxed launch');
  }
  checkTax(p, mode, input.transferFeeBps);

  const key = platformKey(mode);
  const programId = pk(p?.curve?.programId, "curve.programId");
  const quoteMint = new PublicKey(pair.mint);
  const platformId = pk(p?.platform?.[key], `platform.${key}`);
  const configId = getPdaLaunchpadConfigId(programId, quoteMint, 0, 0).publicKey;
  eq(configId, pk(p?.curve?.configId, "curve.configId"), "configId");
  if (p?.allowConfig?.available?.[key] === false) throw new LaunchGuardError(`allowConfig.available.${key} is false: the platform refuses this quote now`);
  const allowConfig = getPdaPlatformAllowConfig(programId, platformId, configId).publicKey;
  eq(allowConfig, pk(p?.allowConfig?.[key], `allowConfig.${key}`), "allowConfig");
  const curveRule = getPdaPlatformCurveRule(programId, platformId, configId).publicKey;
  eq(curveRule, pk(p?.curveRule?.[key], `curveRule.${key}`), "curveRule");

  const raw = p?.raise?.raw;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) throw new LaunchGuardError("pricing.raise.raw must be a raw integer string");
  if (p?.curve?.baseDecimals !== 6) throw new LaunchGuardError("expected curve.baseDecimals 6");
  if (p?.curve?.curveType !== "ConstantCurve") throw new LaunchGuardError(`unsupported curveType ${p?.curve?.curveType}`);
  const quoteTokenProgram = new PublicKey(pair.tokenProgram);
  if (p?.quote?.tokenProgram && p.quote.tokenProgram !== pair.tokenProgram) throw new LaunchGuardError("pricing.quote.tokenProgram differs from pair.tokenProgram");

  const auth = getPdaLaunchpadAuth(programId).publicKey;
  const poolId = getPdaLaunchpadPoolId(programId, input.mint, quoteMint).publicKey;
  const vaultA = getPdaLaunchpadVaultId(programId, poolId, input.mint).publicKey;
  const vaultB = getPdaLaunchpadVaultId(programId, poolId, quoteMint).publicKey;
  const v = p.curve.vesting ?? { totalLockedAmount: "0", cliffPeriod: "0", unlockPeriod: "0" };

  const ix = initializeWithToken2022(
    programId,
    input.payer,
    input.creator,
    configId,
    platformId,
    auth,
    poolId,
    input.mint,
    quoteMint,
    vaultA,
    vaultB,
    quoteTokenProgram,
    6,
    input.name,
    input.symbol,
    input.uri,
    {
      type: "ConstantCurve",
      totalSellA: new BN(p.curve.totalSellA),
      migrateType: p.curve.migrateType,
      supply: new BN(p.curve.supply),
      totalFundRaisingB: new BN(raw),
    },
    new BN(v.totalLockedAmount),
    new BN(v.cliffPeriod),
    new BN(v.unlockPeriod),
    p.curve.cpmmCreatorFeeOn,
    mode === "standard" ? undefined : transferFeeParams(input.transferFeeBps!),
    allowConfig,
    curveRule,
  );
  assertCreateShape(ix, { quoteTokenProgram, allowConfig, curveRule });
  return {
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ix],
    derived: {
      programId: programId.toBase58(),
      platformId: platformId.toBase58(),
      configId: configId.toBase58(),
      allowConfig: allowConfig.toBase58(),
      curveRule: curveRule.toBase58(),
      poolId: poolId.toBase58(),
      totalFundRaisingB: raw,
    },
  };
}

/** keys[10] is the base (Token-2022) program, keys[11] the quote program, last two allowConfig then curveRule, read-only. */
export function assertCreateShape(
  ix: TransactionInstruction,
  want: { quoteTokenProgram: PublicKey; allowConfig: PublicKey; curveRule: PublicKey },
): void {
  const k = ix.keys;
  if (!k[10]?.pubkey.equals(TOKEN_2022_PROGRAM_ID)) throw new LaunchGuardError("keys[10] must be TOKEN_2022");
  if (!k[11]?.pubkey.equals(want.quoteTokenProgram)) throw new LaunchGuardError("keys[11] must be the quote token program from pair.tokenProgram");
  const a = k[k.length - 2], c = k[k.length - 1];
  if (!a?.pubkey.equals(want.allowConfig) || a.isWritable || a.isSigner) throw new LaunchGuardError("allowConfig must be the second-to-last read-only account");
  if (!c?.pubkey.equals(want.curveRule) || c.isWritable || c.isSigner) throw new LaunchGuardError("curveRule must be the last read-only account");
}
