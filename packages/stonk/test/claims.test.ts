import { describe, expect, it, vi } from "vitest";
import { createStonkClient } from "../src/index";
import {
  StonkClaimForbiddenError,
  StonkNothingClaimableError,
  isStonkClaimForbiddenError,
  isStonkNothingClaimableError,
} from "../src/errors";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Handler = (url: string, init?: RequestInit) => Response;
function mockFetch(handler: Handler) {
  return vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

const MINT = "So11111111111111111111111111111111111111112";
const WALLET = "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB";

describe("fee claims", () => {
  it("reads claimable fees without a wallet and surfaces the creator-quote-vault scope", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain(`/tokens/${MINT}/fees`);
      return jsonResponse({
        data: {
          claimable: { quote: { amountRaw: "4200000", amountTokens: 4.2, symbol: "USDC" } },
          scope: "creator-quote-vault",
        },
      });
    });
    const client = createStonkClient({ fetchImpl });
    const fees = await client.getTokenFees(MINT);
    expect(fees.claimable?.quote?.amountTokens).toBe(4.2);
    // The scope tells callers: claim ONCE per quote, not per mint.
    expect(fees.scope).toBe("creator-quote-vault");
  });

  it("maps claim-prepare 403 to StonkClaimForbiddenError (no creator position)", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { error: { code: "no_creator_position", message: "no creator position for this launch" } },
        403,
      ),
    );
    const client = createStonkClient({ fetchImpl });
    const err = await client.prepareFeeClaim(MINT, WALLET).catch((e: unknown) => e);
    expect(isStonkClaimForbiddenError(err)).toBe(true);
    expect(err).toBeInstanceOf(StonkClaimForbiddenError);
    expect((err as Error).message).toMatch(/auto-forward/);
  });

  it("maps claim-prepare 409 to StonkNothingClaimableError", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ error: { code: "nothing_claimable", message: "nothing yet" } }, 409),
    );
    const client = createStonkClient({ fetchImpl });
    const err = await client.prepareFeeClaim(MINT, WALLET).catch((e: unknown) => e);
    expect(isStonkNothingClaimableError(err)).toBe(true);
    expect(err).toBeInstanceOf(StonkNothingClaimableError);
  });

  it("passes alreadySubmitted through on idempotent resubmit — original signature, not an error", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse({ data: { signature: "origSig111", alreadySubmitted: true } }),
    );
    const client = createStonkClient({ fetchImpl });
    const res = await client.submitFeeClaim(MINT, {
      creatorWallet: WALLET,
      intentId: "intent-1",
      signedTransaction: "c2lnbmVk",
    });
    expect(res.signature).toBe("origSig111");
    expect(res.alreadySubmitted).toBe(true);
  });

  it("runs the full claim: prepare → sign AS-IS → submit with the intent id", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchImpl = mockFetch((url, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.endsWith("/fees/claim/prepare")) {
        return jsonResponse({ data: { transaction: "dW5zaWduZWQ=", intentId: "intent-9" } });
      }
      return jsonResponse({ data: { signature: "finalSig" } });
    });
    const sign = vi.fn(async (tx: string) => `signed:${tx}`);
    const client = createStonkClient({ fetchImpl });
    const res = await client.claimTokenFees(MINT, WALLET, sign);
    expect(sign).toHaveBeenCalledWith("dW5zaWduZWQ=");
    expect(res.signature).toBe("finalSig");
    const submit = calls.find((c) => c.url.endsWith("/fees/claim/submit"));
    expect(submit?.body).toEqual({
      creatorWallet: WALLET,
      intentId: "intent-9",
      signedTransaction: "signed:dW5zaWduZWQ=",
    });
  });
});
