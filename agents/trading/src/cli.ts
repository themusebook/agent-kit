import { Connection, PublicKey } from "@solana/web3.js";
import { StonkClient, planClaim, planStonkLaunch, buildStonkTrade, type LaunchMode } from "./stonk/index.ts";
import { PumpAiMcp, planClaimCreatorFees, planCreate, planDistribute, planFeeSharing, planTrade } from "./pumpfun-founder/index.ts";
import { ImperialVenue, PhoenixVenue, type PerpOrderIntent } from "./perps/index.ts";
import { BackpackPublic, previewOrder, type OrderInput } from "./backpack/index.ts";
import { Helius, redactApiKey, sendSigned } from "./helius/index.ts";
import { dflowOrder, jupiterOrder, okxSwap } from "./swaps/index.ts";
import { route } from "./svm/index.ts";
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

  backpack markets [--market-type SPOT|PERP]      public reads, no key
  backpack book --symbol SOL_USDC [--limit N]
  backpack ticker|trades --symbol SOL_USDC
  backpack order --preview --symbol S --side Bid|Ask --order-type Limit|Market --quantity Q [--price P] [--time-in-force GTC|IOC|FOK]
                                                  prints the string YOU sign locally; the kit holds no Backpack secret

  helius assets --owner W [--devnet]              DAS getAssetsByOwner (fungibles + native). Needs HELIUS_API_KEY in env
  helius history --address A [--limit N]          getTransactionsForAddress
  helius fees --accounts A,B [--level Medium]     getPriorityFeeEstimate
  helius send-signed --tx BASE64 [--swqos-only]   submit an ALREADY user-signed tx with a Sender tip via Sender

  swap jupiter|dflow|okx --taker W --in MINT --out MINT --amount RAW [--slippage-bps N]
                                                  unsigned swap tx only (okx needs your own onchainos CLI)
  svm route --q "question"                        which solana-dev skill references answer it (docs only)

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
  if (area === "backpack") {
    const bp = new BackpackPublic();
    switch (cmd) {
      case "markets": return io.out(await bp.markets(typeof f.marketType === "string" ? f.marketType : undefined));
      case "book": return io.out(await bp.depth(need(f, "symbol"), f.limit ? Number(f.limit) : undefined));
      case "ticker": return io.out(await bp.ticker(need(f, "symbol")));
      case "trades": return io.out(await bp.trades(need(f, "symbol"), f.limit ? Number(f.limit) : undefined));
      case "order": {
        if (f.preview !== true) throw new Error("backpack order is preview-only: pass --preview");
        const o: OrderInput = { symbol: need(f, "symbol"), side: need(f, "side") as OrderInput["side"], orderType: need(f, "orderType") as OrderInput["orderType"] };
        for (const k of ["quantity", "quoteQuantity", "price", "timeInForce"] as const) if (typeof f[k] === "string") (o as any)[k] = f[k];
        return io.out(previewOrder(o));
      }
    }
  }

  if (area === "helius") {
    if (cmd === "send-signed") return io.out({ signature: await sendSigned(need(f, "tx"), { swqosOnly: f.swqosOnly === true }) });
    const h = new Helius({ network: f.devnet === true ? "devnet" : "mainnet" });
    switch (cmd) {
      case "assets": return io.out(await h.assetsByOwner(need(f, "owner"), { limit: Number(f.limit ?? 100) }));
      case "history": return io.out(await h.transactionsForAddress(need(f, "address"), { limit: Number(f.limit ?? 25) }));
      case "fees": return io.out(await h.priorityFee({ accountKeys: need(f, "accounts").split(","), priorityLevel: (typeof f.level === "string" ? f.level : "Medium") as any, includeAllPriorityFeeLevels: true }));
    }
  }

  if (area === "swap") {
    const q = { inputMint: need(f, "in"), outputMint: need(f, "out"), amount: need(f, "amount"), taker: need(f, "taker"), ...(f.slippageBps ? { slippageBps: Number(f.slippageBps) } : {}) };
    switch (cmd) {
      case "jupiter": return io.out(await jupiterOrder(q));
      case "dflow": return io.out(await dflowOrder(q));
      case "okx": return io.out(await okxSwap({ from: q.inputMint, to: q.outputMint, amount: q.amount, wallet: q.taker, ...(f.slippage ? { slippage: String(f.slippage) } : {}) }));
    }
  }

  if (area === "svm" && cmd === "route") return io.out(route(need(f, "q")));
  console.log(HELP);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(redactApiKey(e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
}
