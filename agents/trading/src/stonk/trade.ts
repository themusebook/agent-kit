import BN from "bn.js";
import { Connection, PublicKey } from "@solana/web3.js";
import { Raydium, TxVersion } from "@raydium-io/raydium-sdk-v2";
import type { Network, UnsignedTx } from "../unsigned.ts";

export interface StonkTradeInput {
  connection: Connection;
  network: Network;
  owner: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  side: "buy" | "sell";
  /** buy: raw quote amount in; sell: raw token amount in. */
  amountRaw: string;
  slippageBps: number;
}

export function checkTradeInput(i: Pick<StonkTradeInput, "amountRaw" | "slippageBps" | "side">): void {
  if (!/^\d+$/.test(i.amountRaw) || i.amountRaw === "0") throw new Error("amountRaw must be a positive raw integer");
  if (!Number.isInteger(i.slippageBps) || i.slippageBps < 1 || i.slippageBps > 5000) throw new Error("slippageBps must be 1..5000");
  if (i.side !== "buy" && i.side !== "sell") throw new Error("side must be buy or sell");
}

/**
 * Trade a Stonk LaunchLab token on its Raydium bonding curve. Raydium loads
 * with the owner's PUBLIC key only (no signer), so the SDK returns an unsigned
 * v0 transaction that we serialize for the user's wallet.
 */
export async function buildStonkTrade(i: StonkTradeInput): Promise<UnsignedTx> {
  checkTradeInput(i);
  const raydium = await Raydium.load({
    connection: i.connection,
    owner: i.owner,
    cluster: i.network === "devnet" ? "devnet" : "mainnet",
    disableLoadToken: true,
    disableFeatureCheck: true,
  });
  const slippage = new BN(i.slippageBps);
  const amount = new BN(i.amountRaw);
  const r: any =
    i.side === "buy"
      ? await raydium.launchpad.buyToken({ mintA: i.mint, mintB: i.quoteMint, buyAmount: amount, slippage, txVersion: TxVersion.V0, feePayer: i.owner })
      : await raydium.launchpad.sellToken({ mintA: i.mint, mintB: i.quoteMint, sellAmount: amount, slippage, txVersion: TxVersion.V0, feePayer: i.owner });
  const tx = r.transaction;
  const msg = tx.message;
  return {
    kind: "unsigned-transaction",
    network: i.network,
    feePayer: i.owner.toBase58(),
    recentBlockhash: msg.recentBlockhash,
    base64: Buffer.from(tx.serialize()).toString("base64"),
    requiredSigners: msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures).map((k: PublicKey) => k.toBase58()),
    partiallySignedBy: [],
    description: `stonk ${i.side} ${i.amountRaw} raw of ${i.mint.toBase58()} (slippage ${i.slippageBps} bps)`,
  };
}
