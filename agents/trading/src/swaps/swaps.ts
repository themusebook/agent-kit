import { requestJson, type RequestOptions } from "../http.ts";

export interface UnsignedSwap {
  kind: "unsigned-swap";
  venue: "jupiter" | "dflow" | "okx";
  /** base64 transaction for the user's wallet to sign. Nothing here signs it. */
  transaction: string;
  inAmount?: string;
  outAmount?: string;
  meta: Record<string, unknown>;
  submit: string;
}

const isPk = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
function check(q: { inputMint: string; outputMint: string; amount: string | number; taker: string; slippageBps?: number | "auto" }) {
  for (const k of ["inputMint", "outputMint", "taker"] as const) if (!isPk(q[k])) throw new Error(`${k} must be a base58 address`);
  if (!/^\d+$/.test(String(q.amount)) || BigInt(q.amount) <= 0n) throw new Error("amount must be a positive integer in base units");
  if (q.slippageBps !== undefined && q.slippageBps !== "auto" && (!Number.isInteger(q.slippageBps) || q.slippageBps < 0 || q.slippageBps > 10_000)) throw new Error("slippageBps must be 0..10000");
}

// ---- Jupiter Swap API V2 (developers.jup.ag) ----
export const JUPITER_API = "https://api.jup.ag/swap/v2";

export async function jupiterOrder(q: { inputMint: string; outputMint: string; amount: string | number; taker: string; slippageBps?: number }, o: RequestOptions & { apiKey?: string; env?: Record<string, string | undefined> } = {}): Promise<UnsignedSwap> {
  check(q);
  const key = o.apiKey ?? (o.env ?? process.env).JUPITER_API_KEY;
  const p = new URLSearchParams({ inputMint: q.inputMint, outputMint: q.outputMint, amount: String(q.amount), taker: q.taker });
  if (q.slippageBps !== undefined) p.set("slippageBps", String(q.slippageBps));
  const { body } = await requestJson(`${JUPITER_API}/order?${p}`, { headers: key ? { "x-api-key": key } : {} }, o);
  if (!body?.transaction) throw new Error(`Jupiter returned no transaction${body?.errorMessage ? `: ${body.errorMessage}` : ""}`);
  return {
    kind: "unsigned-swap", venue: "jupiter", transaction: body.transaction, inAmount: body.inAmount, outAmount: body.outAmount,
    meta: { requestId: body.requestId, router: body.router, mode: body.mode, feeBps: body.feeBps, feeMint: body.feeMint },
    submit: `After the user signs: POST ${JUPITER_API}/execute {signedTransaction, requestId}`,
  };
}

// ---- DFlow Trade API (pond.dflow.net) ----
export const DFLOW_DEV_API = "https://dev-quote-api.dflow.net";

export async function dflowOrder(q: { inputMint: string; outputMint: string; amount: string | number; taker: string; slippageBps?: number | "auto" }, o: RequestOptions & { base?: string; apiKey?: string; env?: Record<string, string | undefined> } = {}): Promise<UnsignedSwap> {
  check(q);
  const env = o.env ?? process.env;
  const base = o.base ?? env.DFLOW_TRADE_API_URL ?? DFLOW_DEV_API;
  const key = o.apiKey ?? env.DFLOW_API_KEY;
  const p = new URLSearchParams({ inputMint: q.inputMint, outputMint: q.outputMint, amount: String(q.amount), slippageBps: String(q.slippageBps ?? "auto"), userPublicKey: q.taker });
  const { body } = await requestJson(`${base}/order?${p}`, { headers: key ? { "x-api-key": key } : {} }, o);
  if (!body?.transaction) throw new Error("DFlow returned no transaction");
  return {
    kind: "unsigned-swap", venue: "dflow", transaction: body.transaction, inAmount: body.inAmount, outAmount: body.outAmount,
    meta: { executionMode: body.executionMode, lastValidBlockHeight: body.lastValidBlockHeight },
    submit: `After the user signs: send via Helius Sender, then poll ${base}/order-status?signature=<sig>${body.executionMode === "async" ? " (async: poll until closed)" : ""}`,
  };
}

// ---- OKX via the user-installed onchainos CLI ----
export type Exec = (cmd: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
export const OKX_MAX_PRICE_IMPACT_PCT = 10;

const bunExec: Exec = async (cmd, args) => {
  const p = Bun.spawn([cmd, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, stdout, stderr };
};

/**
 * Quote, refuse honeypots and high price impact, then ask onchainos for the swap
 * tx data. onchainos must be installed by the user; the kit never installs it.
 */
export async function okxSwap(q: { from: string; to: string; amount: string; wallet: string; slippage?: string; maxPriceImpactPct?: number }, o: { exec?: Exec } = {}): Promise<UnsignedSwap> {
  if (!isPk(q.wallet)) throw new Error("wallet must be a base58 address");
  const exec = o.exec ?? bunExec;
  const run = async (args: string[]) => {
    const r = await exec("onchainos", args).catch(() => ({ code: 127, stdout: "", stderr: "onchainos not found" }));
    if (r.code !== 0) throw new Error(r.code === 127 ? "onchainos CLI not installed. Install it yourself from OKX's docs; the kit will not." : `onchainos failed: ${r.stderr.trim()}`);
    const j = JSON.parse(r.stdout);
    return j?.data ?? j;
  };
  const base = ["--from", q.from, "--to", q.to, "--amount", q.amount, "--chain", "solana"];
  const quote = await run(["swap", "quote", ...base]);
  const qd = Array.isArray(quote) ? quote[0] : quote;
  const tokens = [qd?.fromToken, qd?.toToken].filter(Boolean);
  if (tokens.some((t: any) => t.isHoneyPot === true || t.isHoneyPot === "true")) throw new Error("refused: OKX flags a token as a honeypot");
  const impact = Math.abs(Number(qd?.priceImpactPercent ?? qd?.priceImpactPercentage ?? 0));
  const maxImpact = q.maxPriceImpactPct ?? OKX_MAX_PRICE_IMPACT_PCT;
  if (impact > maxImpact) throw new Error(`refused: price impact ${impact}% exceeds ${maxImpact}%`);
  const swap = await run(["swap", "swap", ...base, "--wallet", q.wallet, "--slippage", q.slippage ?? "1"]);
  const sd = Array.isArray(swap) ? swap[0] : swap;
  if (!sd?.tx?.data) throw new Error("onchainos returned no tx.data");
  return {
    kind: "unsigned-swap", venue: "okx", transaction: sd.tx.data, inAmount: qd?.fromTokenAmount, outAmount: qd?.toTokenAmount,
    meta: { priceImpactPct: impact, router: sd.routerResult?.dexRouterList?.length ?? undefined },
    submit: "After the user signs: send via Helius Sender. Never auto-execute from signals.",
  };
}
