import { PublicKey } from "@solana/web3.js";
import { buildUnsignedTx, ephemeralMintKeypair, type Network, type UnsignedTx } from "../unsigned.ts";
import type { StonkClient } from "./client.ts";
import { buildLaunchLabInstructions, LaunchGuardError, type LaunchMode } from "./launchlab.ts";

export interface StonkLaunchRequest {
  creator: string;
  quoteMint: string;
  mode: LaunchMode;
  name: string;
  symbol: string;
  uri: string;
  transferFeeBps?: number;
  confirmedStandardMint?: string;
  recentBlockhash: string;
  network: Network;
}

/**
 * Build-it-yourself LaunchLab launch: live /stats -> /pairs -> /launchlab/pricing,
 * then an in-memory mint keypair co-signs and is dropped. The creator signs in their wallet.
 */
export async function planStonkLaunch(client: StonkClient, r: StonkLaunchRequest): Promise<{ tx: UnsignedTx; mint: string; derived: Record<string, string> }> {
  const { launchLab } = await client.launchPaths();
  if (!launchLab) throw new LaunchGuardError("stats.config.launchLabEnabled is false");
  const { pairs } = await client.pairs({ launchable: true, launchLabReady: true });
  const pair = pairs.find((p: any) => p.mint === r.quoteMint);
  if (!pair) throw new LaunchGuardError(`quote ${r.quoteMint} is not a launchable, LaunchLab-ready pair`);
  const pricing = await client.pricing(r.quoteMint);
  let confirmedStandardLaunch: { mint: string; launchpad: string } | undefined;
  if (r.mode !== "standard") {
    if (!r.confirmedStandardMint) throw new LaunchGuardError("taxed launch needs --confirmed-standard <mint> of a landed standard launch");
    const t = await client.token(r.confirmedStandardMint);
    confirmedStandardLaunch = { mint: r.confirmedStandardMint, launchpad: String(t?.launchpad ?? t?.token?.launchpad ?? "") };
  }
  const creator = new PublicKey(r.creator);
  let mintKp: ReturnType<typeof ephemeralMintKeypair> | null = ephemeralMintKeypair();
  try {
    const { instructions, derived } = buildLaunchLabInstructions({
      payer: creator,
      creator,
      mint: mintKp.publicKey,
      pair,
      pricing,
      mode: r.mode,
      name: r.name,
      symbol: r.symbol,
      uri: r.uri,
      transferFeeBps: r.transferFeeBps,
      confirmedStandardLaunch,
    });
    const mint = mintKp.publicKey.toBase58();
    const tx = buildUnsignedTx({
      network: r.network,
      feePayer: creator,
      recentBlockhash: r.recentBlockhash,
      instructions,
      ephemeralMint: mintKp,
      description: `stonk LaunchLab ${r.mode} launch of ${r.symbol} against ${pair.symbol ?? r.quoteMint}; priced at ${pricing?.prices?.observedAt ?? "unknown"}`,
    });
    return { tx, mint, derived };
  } finally {
    mintKp = null;
  }
}
