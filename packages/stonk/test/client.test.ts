import { describe, expect, it, vi } from "vitest";
import { createStonkClient, STONK_V1_BASE, STONK_V2_BASE } from "../src/index";
import {
  StonkApiError,
  StonkRateLimitError,
  isStonkRateLimitError,
} from "../src/errors";
import { availableLaunchPaths, chooseLaunchPath, type StonkStats } from "../src/reads";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: unknown, init?: RequestInit) => handler(String(input), init)) as unknown as typeof fetch;
}

describe("StonkHttp envelope + error shapes", () => {
  it("unwraps the v1 { data, meta } envelope", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe(`${STONK_V1_BASE}/tokens/abc`);
      return jsonResponse({ data: { mint: "abc", symbol: "STK" }, meta: { page: 1 } });
    });
    const client = createStonkClient({ fetchImpl });
    const token = await client.getToken("abc");
    expect(token.symbol).toBe("STK");
  });

  it("maps a v1 error { error: { code, message } } onto StonkApiError with the code", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { error: { code: "invalid_request", message: "backing is pump launches only" } },
        { status: 400 },
      ),
    );
    const client = createStonkClient({ fetchImpl });
    await expect(client.getTokenBacking("abc")).rejects.toMatchObject({
      name: "StonkApiError",
      statusCode: 400,
      code: "invalid_request",
      message: "backing is pump launches only",
    });
  });

  it("maps a v2 error { error: string } onto StonkApiError without a code, using the v2 base", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.startsWith(`${STONK_V2_BASE}/`)).toBe(true);
      return jsonResponse({ error: "pool not found" }, { status: 404 });
    });
    const client = createStonkClient({ fetchImpl });
    const err = await client.getTokenRewards("abc").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StonkApiError);
    expect((err as StonkApiError).message).toBe("pool not found");
    expect((err as StonkApiError).code).toBeUndefined();
  });

  it("maps 429 to StonkRateLimitError carrying Retry-After", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { error: { code: "rate_limited", message: "slow down" } },
        { status: 429, headers: { "retry-after": "12", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1760000000" } },
      ),
    );
    const client = createStonkClient({ fetchImpl });
    const err = await client.listTokens().catch((e: unknown) => e);
    expect(isStonkRateLimitError(err)).toBe(true);
    expect((err as StonkRateLimitError).retryAfterSeconds).toBe(12);
    expect((err as StonkRateLimitError).rateLimit?.remaining).toBe(0);
  });

  it("tracks the rate-limit snapshot from ordinary responses", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { data: { config: { paidLaunchesEnabled: true, launchLabEnabled: false } } },
        { headers: { "x-ratelimit-remaining": "297", "x-ratelimit-reset": "1760000060" } },
      ),
    );
    const client = createStonkClient({ fetchImpl });
    await client.getStats();
    expect(client.rateLimit.remaining).toBe(297);
    expect(client.rateLimit.reset).toBe(1760000060);
  });
});

describe("stats-gated launch path selection", () => {
  const stats = (paid: boolean, lab: boolean): StonkStats => ({
    config: { paidLaunchesEnabled: paid, launchLabEnabled: lab },
  });

  it("lists both paths when both are live", () => {
    expect(availableLaunchPaths(stats(true, true))).toEqual(["api", "launchlab"]);
  });

  it("prefers the API path by default, falls back to LaunchLab", () => {
    expect(chooseLaunchPath(stats(true, true))).toBe("api");
    expect(chooseLaunchPath(stats(false, true))).toBe("launchlab");
    expect(chooseLaunchPath(stats(true, false), "launchlab")).toBe("api");
  });

  it("refuses when the venue has BOTH paths disabled", () => {
    expect(availableLaunchPaths(stats(false, false))).toEqual([]);
    expect(() => chooseLaunchPath(stats(false, false))).toThrow(/BOTH launch paths disabled/);
  });
});
