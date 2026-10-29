import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Side, createPhoenixClient, type PhoenixClient } from "@ellipsis-labs/rise";
import { buildUnsignedTx, type Network } from "../unsigned.ts";
import { checkIntent, type OrderResult, type PerpOrderIntent, type PerpsVenue } from "./venue.ts";

/** @solana/kit AccountRole: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer. */
export function kitToWeb3(ix: { programAddress: string; accounts?: readonly { address: string; role: number }[]; data?: Uint8Array | ArrayLike<number> }): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({ pubkey: new PublicKey(a.address), isSigner: a.role >= 2, isWritable: a.role === 1 || a.role === 3 })),
    data: Buffer.from(ix.data ?? []),
  });
}

/** Phoenix perps through the official Rise SDK: build-only instructions, signed by the trader's wallet. */
export class PhoenixVenue implements PerpsVenue {
  readonly id = "phoenix" as const;
  private client: PhoenixClient;
  constructor(private readonly opts: { rpcUrl?: string; apiUrl?: string; network: Network; client?: PhoenixClient }) {
    this.client = opts.client ?? createPhoenixClient({ rpcUrl: opts.rpcUrl, apiUrl: opts.apiUrl, ws: false } as any);
  }
  markets() {
    return this.client.api.markets().getMarkets();
  }
  positions(wallet: string) {
    return (this.client.api.traders() as any).getTraderState?.(wallet) ?? Promise.reject(new Error("trader-state read not exposed by this Rise version"));
  }
  async buildOrder(intent: PerpOrderIntent, ctx: { recentBlockhash: string }): Promise<OrderResult> {
    checkIntent(intent);
    const symbol = intent.symbol.toUpperCase().replace(/-PERP$/, "");
    const orderPacket = await this.client.orderPackets.buildMarketOrderPacket({
      symbol,
      side: intent.side === "long" ? Side.Bid : Side.Ask,
      baseUnits: intent.baseUnits,
      priceLimitUsd: intent.priceLimitUsd,
    });
    const ix = await this.client.ixs.buildPlaceMarketOrder({ authority: intent.authority as any, symbol: symbol as any, orderPacket });
    const tx = buildUnsignedTx({
      network: this.opts.network,
      feePayer: new PublicKey(intent.authority),
      recentBlockhash: ctx.recentBlockhash,
      instructions: [kitToWeb3(ix as any)],
      description: `phoenix ${intent.side} ${intent.baseUnits} ${symbol} limit $${intent.priceLimitUsd}`,
    });
    return { status: "unsigned", tx };
  }
}
