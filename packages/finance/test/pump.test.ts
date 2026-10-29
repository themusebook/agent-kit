import { describe, expect, it, vi } from "vitest";
import {
  buildAgentPaymentInvoice,
  buildCollectFeesRequest,
  buildCreateCoinRequest,
  buildFeeSharingConfigRequest,
  buildSwapRequest,
  createPumpHttpAdapter,
  isPumpValidationError,
  PumpApiError,
  PumpValidationError,
} from "../src/pump";

const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB";

describe("buildCreateCoinRequest", () => {
  it("builds a descriptor for /agents/create-coin that requires the user's signature", () => {
    const d = buildCreateCoinRequest({
      metadata: { name: "Coin", symbol: "CN", image: "https://example.com/i.png" },
      initialBuySol: 0.5,
      mayhem: true,
    });
    expect(d.kind).toBe("pumpCreateCoin");
    expect(d.endpoint).toBe("https://fun-block.pump.fun/agents/create-coin");
    expect(d.requiresUserSignature).toBe(true);
    expect(d.transactionEncoding).toBe("base64");
    expect(d.body).toMatchObject({ initialBuySol: 0.5, mayhem: true });
    expect(d.warnings.join(" ")).toMatch(/never signs for the user/);
  });

  it("validates metadata and bps fields", () => {
    expect(() =>
      buildCreateCoinRequest({ metadata: { name: "", symbol: "X", image: "i" } }),
    ).toThrow(PumpValidationError);
    expect(() =>
      buildCreateCoinRequest({
        metadata: { name: "C", symbol: "X", image: "i" },
        tokenizedAgentBps: 10_001,
      }),
    ).toThrow(/tokenizedAgentBps/);
  });
});

describe("buildSwapRequest", () => {
  it("REQUIRES slippageBps — there is no default to invent", () => {
    const missing = {
      mint: MINT,
      side: "buy",
      amountSol: 0.1,
      marketState: "bonding-curve",
      // slippageBps deliberately absent at runtime
    } as unknown as Parameters<typeof buildSwapRequest>[0];
    expect(() => buildSwapRequest(missing)).toThrow(/slippageBps is REQUIRED/);
  });

  it("requires exactly one amount and a known market state, and notes the route", () => {
    expect(() =>
      buildSwapRequest({
        mint: MINT,
        side: "buy",
        amountSol: 0.1,
        amountTokens: 5,
        slippageBps: 100,
        marketState: "bonding-curve",
      }),
    ).toThrow(/exactly one/);
    const grad = buildSwapRequest({
      mint: MINT,
      side: "sell",
      amountTokens: 1000,
      slippageBps: 250,
      marketState: "graduated-amm",
    });
    expect(grad.warnings.join(" ")).toMatch(/Pump AMM/);
    const curve = buildSwapRequest({
      mint: MINT,
      side: "buy",
      amountSol: 0.1,
      slippageBps: 250,
      marketState: "bonding-curve",
    });
    expect(curve.warnings.join(" ")).toMatch(/bonding curve/);
  });

  it("rejects a bad mint", () => {
    const err = (() => {
      try {
        buildSwapRequest({
          mint: "not-a-key",
          side: "buy",
          amountSol: 1,
          slippageBps: 100,
          marketState: "bonding-curve",
        });
      } catch (e) {
        return e;
      }
    })();
    expect(isPumpValidationError(err)).toBe(true);
  });
});

describe("fee flows", () => {
  it("collect-fees descriptor carries the kind", () => {
    const d = buildCollectFeesRequest({ mint: MINT, kind: "cashback" });
    expect(d.endpoint).toBe("https://fun-block.pump.fun/agents/collect-fees");
    expect(d.body).toEqual({ mint: MINT, kind: "cashback" });
  });

  it("fee-sharing config REQUIRES shares to sum to exactly 10000 bps", () => {
    expect(() =>
      buildFeeSharingConfigRequest({
        mint: MINT,
        recipients: [
          { wallet: WALLET, shareBps: 6000 },
          { wallet: WALLET, shareBps: 3000 },
        ],
      }),
    ).toThrow(/sum to exactly 10000/);
    const ok = buildFeeSharingConfigRequest({
      mint: MINT,
      recipients: [
        { wallet: WALLET, shareBps: 6000 },
        { wallet: WALLET, shareBps: 4000 },
      ],
    });
    expect(ok.kind).toBe("pumpFeeSharingConfig");
  });
});

describe("buildAgentPaymentInvoice", () => {
  it("anchors duplicate protection on the Invoice ID PDA and mandates on-chain verification", () => {
    const inv = buildAgentPaymentInvoice({
      service: "research report",
      price: 0.05,
      currency: "SOL",
      payer: WALLET,
    });
    expect(inv.duplicateProtection).toBe("invoice-id-pda");
    expect(inv.verifyOnChainBeforeDelivery).toBe(true);
    expect(inv.warnings.join(" ")).toMatch(/ON-CHAIN/);
  });
});

describe("createPumpHttpAdapter", () => {
  it("POSTs the descriptor and returns the unsigned transaction for the user to co-sign", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("https://fun-block.pump.fun/agents/create-coin");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ transaction: "dW5zaWduZWQtdHg=" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const adapter = createPumpHttpAdapter(fetchImpl);
    const res = await adapter.submit(
      buildCreateCoinRequest({
        metadata: { name: "C", symbol: "X", image: "https://example.com/i.png" },
      }),
    );
    expect(res.transactionBase64).toBe("dW5zaWduZWQtdHg=");
  });

  it("maps HTTP failures onto PumpApiError", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 502 }),
    ) as unknown as typeof fetch;
    const adapter = createPumpHttpAdapter(fetchImpl);
    await expect(
      adapter.submit(buildCollectFeesRequest({ mint: MINT, kind: "creator" })),
    ).rejects.toBeInstanceOf(PumpApiError);
  });
});
