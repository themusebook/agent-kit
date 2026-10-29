import { describe, expect, it, vi } from "vitest";
import { createStonkClient } from "../src/index";

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

const WALLET = "GThUX1Atko4tqhNho43ddSNSSEAy76orU8exuMp1yBSB";
const MINT = "So11111111111111111111111111111111111111112";

describe("launch path A (API-built)", () => {
  it("prepare → caller signs the fee payment → submit, keyed by the payment signature", async () => {
    const bodies: Record<string, unknown> = {};
    const fetchImpl = mockFetch((url, init) => {
      if (url.endsWith("/launches/prepare")) {
        return jsonResponse({ data: { transaction: "ZmVlLXBheW1lbnQ=", paymentSignature: "paySig1" } });
      }
      if (url.endsWith("/launches/submit")) {
        bodies.submit = JSON.parse(String(init?.body));
        return jsonResponse({ data: { paymentSignature: "paySig1", status: "processing" } });
      }
      throw new Error(`unexpected ${url}`);
    });
    const sign = vi.fn(async (tx: string) => `signed:${tx}`);
    const client = createStonkClient({ fetchImpl });
    const res = await client.signAndSubmitLaunch({ creatorWallet: WALLET, name: "Coin" }, sign);
    // The signer saw exactly the prepare transaction — the kit never signs itself.
    expect(sign).toHaveBeenCalledWith("ZmVlLXBheW1lbnQ=");
    expect(bodies.submit).toEqual({
      signedTransaction: "signed:ZmVlLXBheW1lbnQ=",
      paymentSignature: "paySig1",
    });
    expect(res.status).toBe("processing");
  });

  it("waitForLaunch polls the payment signature until the status leaves processing", async () => {
    let polls = 0;
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain("/launches/paySig1");
      polls += 1;
      return jsonResponse({
        data:
          polls < 3
            ? { status: "processing" }
            : { status: "complete", mint: MINT },
      });
    });
    const client = createStonkClient({ fetchImpl });
    const status = await client.waitForLaunch("paySig1", {
      sleep: async () => {},
      maxAttempts: 5,
    });
    expect(status.status).toBe("complete");
    expect(status.mint).toBe(MINT);
    expect(polls).toBe(3);
  });

  it("NEVER pays twice: a stuck poll returns the last status without any prepare/submit call", async () => {
    const methods: string[] = [];
    const fetchImpl = mockFetch((_url, init) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse({ data: { status: "processing" } });
    });
    const client = createStonkClient({ fetchImpl });
    const status = await client.waitForLaunch("paySig1", {
      sleep: async () => {},
      maxAttempts: 3,
    });
    expect(status.status).toBe("processing");
    expect(methods).toEqual(["GET", "GET", "GET"]); // polling only — no POST, no second payment
  });

  it("fetches LaunchLab pricing for the quote mint", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toContain(`/launchlab/pricing?quoteMint=${MINT}`);
      return jsonResponse({
        data: {
          curve: { programId: "p", configId: "c", supply: "1", totalSellA: "1", baseDecimals: 6 },
          raise: { raw: "85000000000" },
          platform: {},
          allowConfig: {},
          curveRule: {},
          modes: { reward: { transferFeeBps: [100] } },
        },
      });
    });
    const client = createStonkClient({ fetchImpl });
    const pricing = await client.getLaunchLabPricing(MINT);
    expect(pricing.raise.raw).toBe("85000000000");
  });
});
