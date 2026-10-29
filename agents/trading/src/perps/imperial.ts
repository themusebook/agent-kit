import { requestJson, type RequestOptions } from "../http.ts";
import { decodeUnsignedTx, type Network } from "../unsigned.ts";
import { checkIntent, type OrderResult, type PerpOrderIntent, type PerpsVenue } from "./venue.ts";

export const IMPERIAL_BASE = "https://api.imperial.space/api/v1";

/** Underwriter codes, as in clawd-agents-perps src/imperialAgent.ts (Jupiter 0, Flash 1, Phoenix 2 = default, GMTrade 3). */
export const UNDERWRITER = { jupiter: 0, flash: 1, phoenix: 2, gmtrade: 3 } as const;

/**
 * Imperial is a multi-underwriter router (Jupiter / Flash / Phoenix default / GMTrade).
 * Reads are public REST. Its only order submit is POST /mobile/orders under a JWT session
 * (clawd-agents-perps keeps it dry-run unless IMPERIAL_LIVE=true plus a token), so there is
 * no unsigned order tx for the user.s wallet.
 * The kit therefore never places Imperial orders; it returns a preview.
 * Deposits and withdrawals use POST /deposit/build-tx, which returns a tx the
 * user's wallet still signs.
 */
export class ImperialVenue implements PerpsVenue {
  readonly id = "imperial" as const;
  constructor(private readonly opts: RequestOptions & { base?: string; network: Network } = { network: "mainnet-beta" }) {}
  private get base() {
    return this.opts.base ?? IMPERIAL_BASE;
  }
  private async get(path: string) {
    return (await requestJson(`${this.base}${path}`, {}, this.opts)).body;
  }
  status() { return this.get("/status"); }
  markets() { return this.get("/phoenix/markets"); }
  fundingRates() { return this.get("/gmtrade/funding-rates"); }
  positions(wallet: string) { return this.get(`/positions?walletAddress=${encodeURIComponent(wallet)}`); }
  orders(wallet: string) { return this.get(`/orders?walletAddress=${encodeURIComponent(wallet)}`); }

  async buildOrder(intent: PerpOrderIntent): Promise<OrderResult> {
    checkIntent(intent);
    return {
      status: "disabled",
      reason: "Imperial executes orders server-side under a delegated session (POST /mobile/orders); the kit only hands out transactions the user signs, so Imperial orders are preview-only. Use the phoenix venue for a wallet-signed order.",
      preview: intent,
    };
  }

  /** POST /deposit/build-tx. Returns the tx for the user's wallet; it is never signed or sent here. */
  async buildDeposit(r: { wallet: string; profileIndex: number; amount: number; mode: "deposit" | "withdraw" }) {
    if (!Number.isInteger(r.amount) || r.amount <= 0) throw new Error("amount is USDC base units (6 decimals), a positive integer");
    const { body } = await requestJson(`${this.base}/deposit/build-tx`, { method: "POST", body: JSON.stringify(r) }, this.opts);
    const b64: string | undefined = body?.transaction ?? body?.tx ?? body?.serializedTransaction;
    if (!b64) throw new Error("build-tx returned no transaction");
    decodeUnsignedTx(b64);
    return { kind: "unsigned-transaction" as const, network: this.opts.network, base64: b64, description: `imperial ${r.mode} ${r.amount} USDC units, profile ${r.profileIndex}` };
  }
}
