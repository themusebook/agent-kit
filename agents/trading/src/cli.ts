import { Connection, PublicKey } from "@solana/web3.js";
import { StonkClient, planClaim, planStonkLaunch, buildStonkTrade, type LaunchMode } from "./stonk/index.ts";
import { PumpAiMcp, planClaimCreatorFees, planCreate, planDistribute, planFeeSharing, planTrade } from "./pumpfun-founder/index.ts";
import { ImperialVenue, PhoenixVenue, type PerpOrderIntent } from "./perps/index.ts";
import { assertNoSecrets, type Network } from "./unsigned.ts";

export const HELP = `trading agents: every command prints data or an UNSIGNED transaction for your wallet. Nothing is signed or sent.

  stonk tokens [--q Q] [--page-size N]            market data (v1 /tokens)
  stonk recent [--limit N]                        v2 /launches/recent (server-side)
  stonk paths                                     which launch path /stats enables
  stonk launch --creator W --quote MINT --name N --symbol S --uri U [--mode standard|reward|community|standardV2] [--tax BPS] [--confirmed-standard MINT] [--rpc URL]
  stonk trade --owner W --mint M --quote Q --side buy|sell --amount RAW [--slippage-bps 100] --rpc URL
  stonk claim --mint M --creator W                prepare an unsigned claim (valid 90s)

  pump create --user W --name N --symbol S --uri U [--dev-buy LAMPORTS] [--holder-reward] [--rpc URL]
  pump buy|sell --user W --mint M --amount RAW [--slippage-bps 100] --rpc URL
  pump claim --user W --rpc URL                   collect creator fees (coins without fee sharing)
  pump fees --user W --mint M --shares ADDR:BPS,ADDR:BPS [--graduated]
  pump distribute --user W --mint M [--graduated] --rpc URL
  pump mcp                                        probe PUMPAI_MCP_URL (default https://pumpai.ai/mcp), read tools only

  perps markets --venue phoenix|imperial
  perps order --venue phoenix|imperial --authority W --symbol SOL --side long|short --base 0.1 --limit-usd 150 [--rpc URL]

Network: devnet unless --network mainnet-beta. Without --rpc a dry-run blockhash is used (the tx is for inspection, not landing).`;

const DRY_RUN_BLOCKHASH = "11111111111111111111111111111111";

export function parseArgs(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (argv[i + 1] === undefined || argv[i + 1]!.startsWith("--")) flags[k] = true;
    else flags[k] = argv[++i]!;
  }
  return { pos, flags };
}

const need = (f: Record<string, string | true>, k: string): string => {
  const v = f[k];
  if (typeof v !== "string" || !v) throw new Error(`--${k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())} is required`);
  return v;
};

export async function main(argv: string[], io: { out: (v: unknown) => void } = { out: (v) => console.log(JSON.stringify(v, null, 2)) }) {
  const { pos: [area, cmd], flags: f } = parseArgs(argv);
  assertNoSecrets(f, "flags");
  const network: Network = f.network === "mainnet-beta" ? "mainnet-beta" : "devnet";
  const rpc = typeof f.rpc === "string" ? f.rpc : undefined;
  const connection = rpc ? new Connection(rpc, "confirmed") : undefined;
  const blockhash = async () => (connection ? (await connection.getLatestBlockhash()).blockhash : DRY_RUN_BLOCKHASH);
  const dryRun = !connection;
  const slippageBps = Number(f.slippageBps ?? 100);

  if (area === "stonk") {
    const c = new StonkClient({ serverSide: true });
    switch (cmd) {
      case "tokens": return io.out(await c.tokens({ ...(f.q ? { q: String(f.q) } : {}), pageSize: Number(f.pageSize ?? 10) }));
      case "recent": return io.out(await c.recentLaunches({ limit: Number(f.limit ?? 10) }));
      case "paths": return io.out(await c.launchPaths());
      case "launch": {
        const r = await planStonkLaunch(c, {
          creator: need(f, "creator"), quoteMint: need(f, "quote"), name: need(f, "name"), symbol: need(f, "symbol"), uri: need(f, "uri"),
          mode: (f.mode ?? "standard") as LaunchMode, transferFeeBps: f.tax ? Number(f.tax) : undefined,
          confirmedStandardMint: typeof f.confirmedStandard === "string" ? f.confirmedStandard : undefined,
          recentBlockhash: await blockhash(), network: "mainnet-beta",
        });
        return io.out({ dryRun, ...r });
      }
      case "trade": {
        if (!connection) throw new Error("stonk trade reads the pool on-chain: pass --rpc");
        return io.out(await buildStonkTrade({ connection, network: "mainnet-beta", owner: new PublicKey(need(f, "owner")), mint: new PublicKey(need(f, "mint")), quoteMint: new PublicKey(need(f, "quote")), side: need(f, "side") as "buy" | "sell", amountRaw: need(f, "amount"), slippageBps }));
      }
      case "claim": return io.out(await planClaim(c, need(f, "mint"), need(f, "creator")));
    }
  }

  if (area === "pump") {
    if (cmd === "mcp") {
      const m = new PumpAiMcp();
      const init = await m.initialize();
      const p = await m.tools();
      return io.out({ url: m.url, server: init?.serverInfo, protocolVersion: init?.protocolVersion, exposed: p.exposed.map((t) => t.name), disabled: p.disabled });
    }
    const ctx = { network, user: new PublicKey(need(f, "user")), recentBlockhash: await blockhash(), connection };
    switch (cmd) {
      case "create": return io.out({ dryRun, ...(await planCreate(ctx, { name: need(f, "name"), symbol: need(f, "symbol"), uri: need(f, "uri"), holderReward: f.holderReward === true, devBuyLamports: typeof f.devBuy === "string" ? f.devBuy : undefined, devBuySlippageBps: slippageBps })) });
      case "buy":
      case "sell": return io.out(await planTrade(ctx, { mint: new PublicKey(need(f, "mint")), side: cmd, amountRaw: need(f, "amount"), slippageBps }));
      case "claim": return io.out(await planClaimCreatorFees(ctx));
      case "fees": {
        const shareholders = need(f, "shares").split(",").map((s) => { const [address, bps] = s.split(":"); return { address: address!, shareBps: Number(bps) }; });
        return io.out({ dryRun, tx: await planFeeSharing(ctx, { mint: new PublicKey(need(f, "mint")), graduated: f.graduated === true, shareholders }) });
      }
      case "distribute": return io.out(await planDistribute(ctx, { mint: new PublicKey(need(f, "mint")), graduated: f.graduated === true }));
    }
  }

  if (area === "perps") {
    const venueId = need(f, "venue");
    const venue = venueId === "phoenix" ? new PhoenixVenue({ rpcUrl: rpc, network }) : venueId === "imperial" ? new ImperialVenue({ network }) : null;
    if (!venue) throw new Error("--venue must be phoenix or imperial");
    switch (cmd) {
      case "markets": return io.out(await venue.markets());
      case "order": {
        const intent: PerpOrderIntent = { venue: venue.id, authority: need(f, "authority"), symbol: need(f, "symbol"), side: need(f, "side") as "long" | "short", baseUnits: need(f, "base"), priceLimitUsd: Number(need(f, "limitUsd")) };
        return io.out({ dryRun, ...(await venue.buildOrder(intent, { recentBlockhash: await blockhash() })) });
      }
    }
  }
  console.log(HELP);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
