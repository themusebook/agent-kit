import BN from "bn.js";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  OnlinePumpSdk,
  PUMP_SDK,
  canonicalPumpPoolPda,
  feeSharingConfigPda,
  getBuyTokenAmountFromSolAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
} from "@pump-fun/pump-sdk";
import { OnlinePumpAmmSdk, PUMP_AMM_SDK } from "@pump-fun/pump-swap-sdk";
import { buildUnsignedTx, ephemeralMintKeypair, type Network, type UnsignedTx } from "../unsigned.ts";

export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
export const PUMP_FEES_PROGRAM = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";

export const LIMITS = { name: 32, symbol: 13, uri: 200 } as const;

export class FounderInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FounderInputError";
  }
}

export interface CoinMetadata {
  name: string;
  symbol: string;
  uri: string;
}

/** create_v2 argument limits from docs/instructions/COIN_CREATION.md. */
export function checkMetadata(m: CoinMetadata): void {
  if (!m.name || m.name.length > LIMITS.name) throw new FounderInputError(`name must be 1..${LIMITS.name} characters`);
  if (!m.symbol || m.symbol.length > LIMITS.symbol) throw new FounderInputError(`symbol must be 1..${LIMITS.symbol} characters`);
  if (!m.uri || m.uri.length > LIMITS.uri) throw new FounderInputError(`uri must be 1..${LIMITS.uri} characters`);
  if (!/^(https|ipfs|ar):\/\//.test(m.uri)) throw new FounderInputError("uri must be an https://, ipfs:// or ar:// metadata URI you already uploaded");
}

export function checkShares(shares: { address: string; shareBps: number }[]): void {
  if (shares.length === 0) throw new FounderInputError("at least one shareholder");
  const seen = new Set<string>();
  let total = 0;
  for (const s of shares) {
    new PublicKey(s.address);
    if (seen.has(s.address)) throw new FounderInputError(`duplicate shareholder ${s.address}`);
    seen.add(s.address);
    if (!Number.isInteger(s.shareBps) || s.shareBps <= 0) throw new FounderInputError(`share for ${s.address} must be a positive integer bps`);
    total += s.shareBps;
  }
  if (total !== 10_000) throw new FounderInputError(`shares must total 10000 bps, got ${total}`);
}

const slippagePct = (bps: number) => {
  if (!Number.isInteger(bps) || bps < 1 || bps > 5000) throw new FounderInputError("slippageBps must be 1..5000");
  return bps / 100;
};

export interface FounderContext {
  network: Network;
  user: PublicKey;
  recentBlockhash: string;
  connection?: Connection;
}

const tx = (c: FounderContext, instructions: TransactionInstruction[], description: string, ephemeralMint?: ReturnType<typeof ephemeralMintKeypair>) =>
  buildUnsignedTx({ network: c.network, feePayer: c.user, recentBlockhash: c.recentBlockhash, instructions, description, ephemeralMint });

const online = (c: FounderContext) => {
  if (!c.connection) throw new FounderInputError("this step reads on-chain state: pass --rpc");
  return new OnlinePumpSdk(c.connection);
};

/**
 * create_v2 (SOL-paired by default). An optional dev buy appends buy_v2 via
 * createV2AndBuyV2Instructions, which needs the Global account. The mint
 * keypair is generated here, co-signs, and is dropped.
 */
export async function planCreate(
  c: FounderContext,
  m: CoinMetadata & { creator?: PublicKey; mayhemMode?: boolean; holderReward?: boolean; devBuyLamports?: string; devBuySlippageBps?: number },
): Promise<{ tx: UnsignedTx; mint: string }> {
  checkMetadata(m);
  let mintKp: ReturnType<typeof ephemeralMintKeypair> | null = ephemeralMintKeypair();
  try {
    const creator = m.creator ?? c.user;
    let ixs: TransactionInstruction[];
    if (m.devBuyLamports && m.devBuyLamports !== "0") {
      const sdk = online(c);
      const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
      const quoteAmount = new BN(m.devBuyLamports);
      const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: quoteAmount, quoteMint: NATIVE_MINT });
      ixs = await PUMP_SDK.createV2AndBuyV2Instructions({
        global,
        mint: mintKp.publicKey,
        name: m.name,
        symbol: m.symbol,
        uri: m.uri,
        creator,
        user: c.user,
        amount,
        quoteAmount,
        mayhemMode: m.mayhemMode ?? false,
        holderReward: m.holderReward ?? false,
        slippage: slippagePct(m.devBuySlippageBps ?? 100),
      } as any);
    } else {
      ixs = [
        await PUMP_SDK.createV2Instruction({
          mint: mintKp.publicKey,
          name: m.name,
          symbol: m.symbol,
          uri: m.uri,
          creator,
          user: c.user,
          mayhemMode: m.mayhemMode ?? false,
          holderReward: m.holderReward ?? false,
        }),
      ];
    }
    const mint = mintKp.publicKey.toBase58();
    return { tx: tx(c, ixs, `pump create_v2 ${m.symbol}${m.devBuyLamports ? ` + dev buy ${m.devBuyLamports} lamports` : ""}`, mintKp), mint };
  } finally {
    mintKp = null;
  }
}

/**
 * Buy or sell. On the bonding curve: buy_exact_quote_in_v3 / sell_v3.
 * After graduation (curve complete): PumpSwap buyQuoteInput / sellBaseInput on the canonical pool.
 */
export async function planTrade(
  c: FounderContext,
  t: { mint: PublicKey; side: "buy" | "sell"; amountRaw: string; slippageBps: number },
): Promise<{ tx: UnsignedTx; venue: "bonding-curve" | "pumpswap" }> {
  if (!/^\d+$/.test(t.amountRaw) || t.amountRaw === "0") throw new FounderInputError("amountRaw must be a positive raw integer");
  const slippage = slippagePct(t.slippageBps);
  const sdk = online(c);
  const amount = new BN(t.amountRaw);
  const curve = await sdk.fetchBondingCurve(t.mint);
  if (curve.complete) {
    const amm = new OnlinePumpAmmSdk(c.connection!);
    const state = await amm.swapSolanaState(canonicalPumpPoolPda(t.mint), c.user);
    const ixs = t.side === "buy" ? await PUMP_AMM_SDK.buyQuoteInput(state, amount, slippage) : await PUMP_AMM_SDK.sellBaseInput(state, amount, slippage);
    return { tx: tx(c, ixs, `pumpswap ${t.side} ${t.amountRaw} raw of ${t.mint.toBase58()}`), venue: "pumpswap" };
  }
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  if (t.side === "buy") {
    const s = await sdk.fetchBuyState(t.mint, c.user, tokenProgram);
    const tokens = getBuyV3TokenAmountFromQuoteAmount({
      global,
      feeConfig,
      mintSupply: s.bondingCurve.tokenTotalSupply,
      bondingCurve: s.bondingCurve,
      amount,
      curveBaseTokenBalance: s.curveBaseTokenBalance,
      quoteTransferFee: s.quoteTransferFee,
    });
    const ixs = await PUMP_SDK.buyExactQuoteInV3Instructions({
      bondingCurve: s.bondingCurve,
      associatedUserAccountInfo: s.associatedUserAccountInfo,
      mint: t.mint,
      user: c.user,
      amount: tokens,
      quoteAmount: amount,
      slippage,
      tokenProgram,
      quoteTokenProgram: s.quoteTokenProgram,
    });
    return { tx: tx(c, ixs, `pump curve buy ${t.amountRaw} quote raw of ${t.mint.toBase58()}`), venue: "bonding-curve" };
  }
  const s = await sdk.fetchSellState(t.mint, c.user, tokenProgram);
  const quote = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: s.bondingCurve.tokenTotalSupply,
    bondingCurve: s.bondingCurve,
    amount,
    quoteTransferFee: s.quoteTransferFee,
  });
  const ixs = await PUMP_SDK.sellV3Instructions({
    bondingCurve: s.bondingCurve,
    mint: t.mint,
    user: c.user,
    amount,
    quoteAmount: quote,
    slippage,
    tokenProgram,
    quoteTokenProgram: s.quoteTokenProgram,
  });
  return { tx: tx(c, ixs, `pump curve sell ${t.amountRaw} raw of ${t.mint.toBase58()}`), venue: "bonding-curve" };
}

/** collect_creator_fee_v2 + collect_coin_creator_fee across every quote the creator has a vault in. Not for coins with a sharing_config. */
export async function planClaimCreatorFees(c: FounderContext): Promise<UnsignedTx> {
  const ixs = await online(c).collectCoinCreatorFeeAllQuotesInstructions(c.user, c.user);
  if (ixs.length === 0) throw new FounderInputError("no creator fee vaults to collect");
  return tx(c, ixs, `pump collect creator fees for ${c.user.toBase58()}`);
}

/** create_fee_sharing_config then update_fee_shares_v2, in one tx signed by the creator. */
export async function planFeeSharing(
  c: FounderContext,
  f: { mint: PublicKey; graduated: boolean; shareholders: { address: string; shareBps: number }[]; quoteMint?: PublicKey; quoteTokenProgram?: PublicKey },
): Promise<UnsignedTx> {
  checkShares(f.shareholders);
  const create = await PUMP_SDK.createFeeSharingConfig({ creator: c.user, mint: f.mint, pool: f.graduated ? canonicalPumpPoolPda(f.mint) : null });
  const update: TransactionInstruction | TransactionInstruction[] = await PUMP_SDK.updateFeeSharesV2({
    authority: c.user,
    mint: f.mint,
    currentShareholders: [c.user],
    newShareholders: f.shareholders.map((s) => ({ address: new PublicKey(s.address), shareBps: s.shareBps })),
    quoteMint: f.quoteMint ?? NATIVE_MINT,
    quoteTokenProgram: f.quoteTokenProgram ?? TOKEN_PROGRAM_ID,
  } as any);
  return tx(c, [create, ...(Array.isArray(update) ? update : [update])], `pump fee sharing for ${f.mint.toBase58()}: ${f.shareholders.length} shareholders`);
}

/** distribute_creator_fees_v2 for a coin with a sharing_config (permissionless; the user pays). */
export async function planDistribute(c: FounderContext, f: { mint: PublicKey; graduated: boolean; quoteMint?: PublicKey; quoteTokenProgram?: PublicKey }): Promise<UnsignedTx> {
  if (!c.connection) throw new FounderInputError("distribute reads the sharing_config: pass --rpc");
  const quoteMint = f.quoteMint ?? NATIVE_MINT;
  const quoteTokenProgram = f.quoteTokenProgram ?? TOKEN_PROGRAM_ID;
  const sharingConfigAddress = feeSharingConfigPda(f.mint);
  const info = await c.connection.getAccountInfo(sharingConfigAddress);
  if (!info) throw new FounderInputError("this coin has no sharing_config");
  const sharingConfig = PUMP_SDK.decodeSharingConfig(info);
  const ixs: TransactionInstruction[] = [];
  if (f.graduated) ixs.push(await PUMP_SDK.transferCreatorFeesToPumpV2({ payer: c.user, mint: f.mint, quoteMint, quoteTokenProgram }));
  const d: TransactionInstruction | TransactionInstruction[] = await PUMP_SDK.distributeCreatorFeesV2({ mint: f.mint, sharingConfig, sharingConfigAddress, quoteMint, payer: c.user, shouldInitializeAta: true, quoteTokenProgram } as any);
  ixs.push(...(Array.isArray(d) ? d : [d]));
  return tx(c, ixs, `pump distribute creator fees for ${f.mint.toBase58()}`);
}
