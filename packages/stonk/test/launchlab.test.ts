import { describe, expect, it } from "vitest";
import {
  CLASSIC_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  planLaunchLabLaunch,
  validateBuiltLaunchLabInstruction,
  validateLaunchLabAdoptionShape,
  type LaunchLabPdaDeriver,
  type LaunchLabPricing,
} from "../src/launchlab";
import type { StonkPair } from "../src/reads";
import { StonkValidationError } from "../src/errors";

const PROGRAM = "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj";
const CONFIG = "4EWkiiP2hDYSFZBnEn51ZBQSbuZQyEHeY59X2aDQyBHE";
const CREATOR = "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB";
const MINT = "So11111111111111111111111111111111111111112";
const QUOTE = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC (6-dec) — a non-SOL quote
const AUTH = "WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVc";
const POOL = "7YttLkHDoDj53LWh8CnRWtxjNfQwCztVZGXzEJdMWsBv";
const BASE_VAULT = "6XbhkXPJtCvJsnMrTQb2QEMoDHDs8H3bhVQkPz2GxKKK";
const QUOTE_VAULT = "Hj29YRsELjHLqXPGkkMyMGeWkJBCvTjS1EKZKjKKKKK1".slice(0, 44);

const PLAT = {
  standard: "HJEzZfUkWxUCJmUYhbe9YxPaTNxzXDGJWdEdA6UvqnGC",
  reward: "AKnL4NNf3DGxYL6ekhYtWFNCPXBXVs7cLiLPKv8WfkXm",
  community: "Cmm9GS2TmgegrtZpxMTEFRGSBvZsFrL2JQKB6JQdLWBk",
  standardV2: "D8qYcNqYrVLb1heqWMLA81mVgbQy1LHbqzLWcfFzoiHU",
} as const;

const ALLOW: Record<string, string> = {
  [PLAT.standard]: "4B7QYaHGYfU2vikhFcp4zXFMxwqjkgC5Bcjf3wJuMkAA".slice(0, 44),
  [PLAT.reward]: "3yxLhCQNLKSbVLxVbMaLU6Cbh6m55CwhMzvqJvrYHZVv",
  [PLAT.community]: "2BgzCLjG7YyJD3RbsT5EKBT6PjkPM6mVDRxQgFjhpLHf",
  [PLAT.standardV2]: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
};
const RULE: Record<string, string> = {
  [PLAT.standard]: "5fMP5nCeHDQWKeM8gkZ2YDxTSvfDg3RGToiXYsU4kTeR",
  [PLAT.reward]: "6Sn4VxVejPJY2GRaaRAP4YRfajEB8GDGKRuHGiXqCBxc",
  [PLAT.community]: "7TqLmrMJhmQNBVUhLcxFhNZEFgMrKqUZpGhmJBYXjsrd",
  [PLAT.standardV2]: "8UbtJjqfFwMWEmcfsBg8p22XY6oEBdxFmhN9EjbYkYGe",
};

const PRICING: LaunchLabPricing = {
  curve: {
    programId: PROGRAM,
    configId: CONFIG,
    supply: "1000000000000000",
    totalSellA: "800000000000000",
    baseDecimals: 6,
    cpmmCreatorFeeOn: 0,
  },
  // 85,000.00 USDC in 6 decimals — NOT the SDK's 85-SOL lamports constant.
  raise: { raw: "85000000000" },
  platform: { ...PLAT },
  allowConfig: {
    standard: ALLOW[PLAT.standard]!,
    reward: ALLOW[PLAT.reward]!,
    community: ALLOW[PLAT.community]!,
    standardV2: ALLOW[PLAT.standardV2]!,
  },
  curveRule: {
    standard: RULE[PLAT.standard]!,
    reward: RULE[PLAT.reward]!,
    community: RULE[PLAT.community]!,
    standardV2: RULE[PLAT.standardV2]!,
  },
  modes: {
    reward: { transferFeeBps: [100, 200, 300] },
    standardV2: { transferFeeBpsRange: { min: 1, max: 1000 } },
  },
  standardV2Enabled: true,
  communityMode: { offeredOnThisQuote: true },
};

const PAIR: StonkPair = {
  mint: QUOTE,
  symbol: "USDC",
  launchable: true,
  launchLabReady: true,
  tokenProgram: CLASSIC_TOKEN_PROGRAM_ID,
  standardV2Enabled: true,
};

const deriver: LaunchLabPdaDeriver = {
  launchpadAuth: () => AUTH,
  launchpadConfigId: () => CONFIG,
  platformAllowConfig: (_p, platformId) => ALLOW[platformId]!,
  platformCurveRule: (_p, platformId) => RULE[platformId]!,
  launchpadPoolId: () => POOL,
  launchpadVaultId: (_p, _pool, mint) => (mint === MINT ? BASE_VAULT : QUOTE_VAULT),
};

function plan(overrides: Partial<Parameters<typeof planLaunchLabLaunch>[0]> = {}) {
  return planLaunchLabLaunch({
    pricing: PRICING,
    pair: PAIR,
    mode: "standard",
    creator: CREATOR,
    mint: MINT,
    name: "Test",
    symbol: "TST",
    uri: "https://example.com/meta.json",
    deriver,
    ...overrides,
  });
}

describe("planLaunchLabLaunch", () => {
  it("passes pricing.raise.raw through as totalFundRaisingB verbatim (the 85-SOL trap)", () => {
    const p = plan();
    expect(p.curve.totalFundRaisingB).toBe("85000000000");
    expect(p.curve).toMatchObject({
      type: "ConstantCurve",
      supply: "1000000000000000",
      totalSellA: "800000000000000",
      migrateType: "cpmm",
    });
  });

  it("lays out accounts: index 10 = Token-2022, index 11 = the pair's quote program, allow+rule appended LAST read-only", () => {
    const p = plan();
    expect(p.accounts[10]).toMatchObject({ pubkey: TOKEN_2022_PROGRAM_ID, role: "baseTokenProgram" });
    expect(p.accounts[11]).toMatchObject({ pubkey: CLASSIC_TOKEN_PROGRAM_ID, role: "quoteTokenProgram" });
    const lastTwo = p.accounts.slice(-2);
    expect(lastTwo.map((a) => a.role)).toEqual(["platformAllowConfig", "platformCurveRule"]);
    expect(lastTwo.every((a) => a.isWritable === false && a.isSigner === false)).toBe(true);
    expect(p.platformId).toBe(PLAT.standard);
  });

  it("uses the pair's Token-2022 program for xStock-style quotes", () => {
    const p = plan({ pair: { ...PAIR, tokenProgram: TOKEN_2022_PROGRAM_ID } });
    expect(p.accounts[11]!.pubkey).toBe(TOKEN_2022_PROGRAM_ID);
  });

  it("refuses when the derived configId disagrees with pricing (SDK/API mismatch)", () => {
    const bad: LaunchLabPdaDeriver = { ...deriver, launchpadConfigId: () => POOL };
    expect(() => plan({ deriver: bad })).toThrow(StonkValidationError);
    expect(() => plan({ deriver: bad })).toThrow(/disagree/);
  });

  it("refuses when the derived allow-config disagrees with pricing", () => {
    const bad: LaunchLabPdaDeriver = { ...deriver, platformAllowConfig: () => POOL };
    expect(() => plan({ deriver: bad })).toThrow(/allow-config/);
  });

  it("refuses when the derived curve-rule disagrees with pricing", () => {
    const bad: LaunchLabPdaDeriver = { ...deriver, platformCurveRule: () => POOL };
    expect(() => plan({ deriver: bad })).toThrow(/curve-rule/);
  });

  it("refuses pairs that are not launchable, and pairs without a live LaunchLab config", () => {
    expect(() => plan({ pair: { ...PAIR, launchable: false } })).toThrow(/not launchable/);
    expect(() => plan({ pair: { ...PAIR, launchLabReady: false } })).toThrow(/LaunchLab/);
    expect(() => plan({ pair: { ...PAIR, launchLabReady: undefined } })).toThrow(/LaunchLab/);
  });

  it("refuses a pair that does not report its quote token program (never assume classic SPL)", () => {
    const { tokenProgram: _omit, ...pairNoProgram } = PAIR;
    expect(() => plan({ pair: pairNoProgram })).toThrow(/token program/);
  });
});

describe("LaunchLab tax validation per mode", () => {
  it("standard rejects any taxBps", () => {
    expect(() => plan({ taxBps: 100 })).toThrow(/untaxed/);
    expect(plan({ taxBps: 0 }).transferFeeExtension).toBeUndefined();
  });

  it("reward requires a published tier and stamps the EXACT extension keys", () => {
    expect(() => plan({ mode: "reward" })).toThrow(/taxBps is required/);
    expect(() => plan({ mode: "reward", taxBps: 150 })).toThrow(/not one of the published reward tiers/);
    const p = plan({ mode: "reward", taxBps: 200 });
    expect(p.transferFeeExtension).toEqual({
      transferFeeBasePoints: 200,
      maxinumFee: "1000000000000000",
    });
    expect(Object.keys(p.transferFeeExtension!).sort()).toEqual([
      "maxinumFee",
      "transferFeeBasePoints",
    ]);
    expect(p.warnings.join(" ")).toMatch(/taxes holders for nobody|NEVER distributed/);
  });

  it("community requires the quote to offer it, on top of a reward tier", () => {
    expect(() =>
      plan({ mode: "community", taxBps: 100, pricing: { ...PRICING, communityMode: { offeredOnThisQuote: false } } }),
    ).toThrow(/offered/);
    expect(plan({ mode: "community", taxBps: 300 }).platformId).toBe(PLAT.community);
  });

  it("standardV2 requires enablement and a whole-bps rate inside the published range", () => {
    expect(() =>
      plan({ mode: "standardV2", taxBps: 500, pricing: { ...PRICING, standardV2Enabled: false } }),
    ).toThrow(/not enabled/);
    expect(() => plan({ mode: "standardV2", taxBps: 1001 })).toThrow(/outside/);
    expect(() => plan({ mode: "standardV2", taxBps: 12.5 })).toThrow(/whole number/);
    expect(plan({ mode: "standardV2", taxBps: 500 }).platformId).toBe(PLAT.standardV2);
  });
});

describe("validateBuiltLaunchLabInstruction", () => {
  it("accepts the planned layout (SDK extras tolerated before the appended pair)", () => {
    const p = plan();
    const keys = [
      ...p.accounts.slice(0, 12),
      { pubkey: "11111111111111111111111111111111", isWritable: false },
      ...p.accounts.slice(12),
    ];
    expect(
      validateBuiltLaunchLabInstruction(keys, {
        pair: PAIR,
        allowConfigId: p.accounts[12]!.pubkey,
        curveRuleId: p.accounts[13]!.pubkey,
      }),
    ).toEqual([]);
  });

  it("flags the classic-SPL account-11 trap for Token-2022 quotes", () => {
    const t22Pair = { ...PAIR, tokenProgram: TOKEN_2022_PROGRAM_ID };
    const p = plan({ pair: t22Pair });
    const keys = p.accounts.map((a) => ({ pubkey: a.pubkey, isWritable: a.isWritable }));
    keys[11] = { pubkey: CLASSIC_TOKEN_PROGRAM_ID, isWritable: false }; // the SDK default
    const problems = validateBuiltLaunchLabInstruction(keys, {
      pair: t22Pair,
      allowConfigId: p.accounts[12]!.pubkey,
      curveRuleId: p.accounts[13]!.pubkey,
    });
    expect(problems.join(" ")).toMatch(/account 11/);
  });

  it("flags missing appended accounts (the 6018 case)", () => {
    const p = plan();
    const keys = p.accounts.slice(0, 12).map((a) => ({ pubkey: a.pubkey, isWritable: a.isWritable }));
    const problems = validateBuiltLaunchLabInstruction(keys, {
      pair: PAIR,
      allowConfigId: p.accounts[12]!.pubkey,
      curveRuleId: p.accounts[13]!.pubkey,
    });
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

describe("validateLaunchLabAdoptionShape", () => {
  const goodShape = {
    globalConfigId: CONFIG,
    curveKind: "constant-product",
    migrateType: "cpmm",
    supply: "1000000000000000",
    totalSellA: "800000000000000",
    totalFundRaisingB: "85000000000",
    baseMintDecimals: 6,
    baseMintCreatedVia: "initialize_with_token2022",
    transferFeeBps: null,
    platformId: PLAT.standard,
    mode: "standard" as const,
    hasCurveRuleAccount: true,
  };

  it("accepts a shape matching the pricing response exactly", () => {
    expect(validateLaunchLabAdoptionShape(goodShape, PRICING)).toEqual([]);
  });

  it("flags each checklist miss", () => {
    const problems = validateLaunchLabAdoptionShape(
      {
        ...goodShape,
        globalConfigId: POOL,
        supply: "999",
        baseMintDecimals: 9,
        transferFeeBps: 200, // standard must carry no extension
        hasCurveRuleAccount: false,
      },
      PRICING,
    );
    expect(problems.length).toBe(5);
  });

  it("flags an unpublished reward tax rate read off the mint", () => {
    const problems = validateLaunchLabAdoptionShape(
      { ...goodShape, mode: "reward", platformId: PLAT.reward, transferFeeBps: 150 },
      PRICING,
    );
    expect(problems.join(" ")).toMatch(/not a published tier/);
  });
});
