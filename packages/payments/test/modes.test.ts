import { describe, expect, it, vi } from "vitest";
import {
  assertSingleX402Style,
  isExecuteMode,
  MechDelegateClient,
  SPL_TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
  USDC_MINT_MAINNET,
  validatePaymentAsset,
  validateSchemeRequirements,
  X402StyleConflictError,
  type CoreAssetScheme,
  type DelegatedAgentScheme,
  type StandardWalletScheme,
} from "../src/modes";
import {
  AUTH_TOKEN_TTL_MS,
  InMemoryAuthTokenStore,
  LocalStorageAuthTokenStore,
} from "../src/tokenStore";

const WALLET = "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e";
const ASSET = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";

const standard: StandardWalletScheme = {
  kind: "standard-wallet",
  scheme: "ExactSvmScheme",
  signer: WALLET,
};
const core: CoreAssetScheme = {
  kind: "core-asset",
  scheme: "MetaplexSvmExactScheme",
  coreExecute: { asset: ASSET },
};
const mech: DelegatedAgentScheme = {
  kind: "delegated-agent",
  scheme: "Mech",
  delegate: WALLET,
};

describe("payment asset validation — USDC classic SPL only", () => {
  it("accepts mainnet USDC on the classic program", () => {
    expect(
      validatePaymentAsset({ asset: USDC_MINT_MAINNET, tokenProgram: SPL_TOKEN_PROGRAM }),
    ).toEqual([]);
  });

  it("rejects Token-2022 USDC explicitly", () => {
    const problems = validatePaymentAsset({
      asset: USDC_MINT_MAINNET,
      tokenProgram: TOKEN_2022_PROGRAM,
    });
    expect(problems.join(" ")).toMatch(/Token-2022 USDC is not supported/);
  });

  it("rejects non-USDC assets", () => {
    expect(validatePaymentAsset({ asset: ASSET }).join(" ")).toMatch(/USDC/);
  });
});

describe("scheme requirements", () => {
  it("standard wallet is not an execute mode and needs no PDA balance", () => {
    expect(isExecuteMode(standard)).toBe(false);
    expect(validateSchemeRequirements(standard)).toEqual([]);
  });

  it("execute modes flag the signer-PDA SOL requirement", () => {
    expect(isExecuteMode(core)).toBe(true);
    expect(isExecuteMode(mech)).toBe(true);
    expect(validateSchemeRequirements(core).join(" ")).toMatch(/signer PDA to hold SOL/);
    expect(validateSchemeRequirements(core, { signerPdaLamports: 0 }).join(" ")).toMatch(
      /holds no SOL/,
    );
    expect(validateSchemeRequirements(core, { signerPdaLamports: 5000 })).toEqual([]);
  });
});

describe("reactive XOR proactive client style", () => {
  it("accepts exactly one style", () => {
    expect(() => assertSingleX402Style({ kind: "reactive", extension: {} })).not.toThrow();
    expect(() => assertSingleX402Style({ kind: "proactive", wrapper: {} })).not.toThrow();
  });

  it("throws X402StyleConflictError when both are installed", () => {
    expect(() =>
      assertSingleX402Style({ extension: {}, wrapper: {} }),
    ).toThrowError(X402StyleConflictError);
    expect(() => assertSingleX402Style({})).toThrowError(/exactly one/);
  });
});

describe("auth token stores (24h default)", () => {
  it("in-memory store expires tokens after the TTL", async () => {
    const store = new InMemoryAuthTokenStore();
    await store.set("tok", 50);
    expect(await store.get()).toBe("tok");
    await new Promise((r) => setTimeout(r, 70));
    expect(await store.get()).toBeNull();
    expect(AUTH_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("localStorage variant round-trips and clears", async () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const store = new LocalStorageAuthTokenStore(storage);
    await store.set("tok2");
    expect(await store.get()).toBe("tok2");
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe("MechDelegateClient", () => {
  it("status/approve/revoke hit the configured endpoints with the stored token; revoke clears it", async () => {
    const store = new InMemoryAuthTokenStore();
    await store.set("auth-tok");
    const calls: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, auth: init?.headers?.authorization });
      return new Response(JSON.stringify({ status: "approved" }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = new MechDelegateClient(
      "https://hub.example/",
      { status: "/mech/status", approve: "/mech/approve", revoke: "/mech/revoke" },
      store,
      fetchImpl,
    );
    const s = await client.status(WALLET);
    expect(s.status).toBe("approved");
    expect(calls[0]!.url).toBe("https://hub.example/mech/status");
    expect(calls[0]!.auth).toBe("Bearer auth-tok");
    await client.approve(WALLET);
    await client.revoke(WALLET);
    expect(calls.map((c) => c.url)).toEqual([
      "https://hub.example/mech/status",
      "https://hub.example/mech/approve",
      "https://hub.example/mech/revoke",
    ]);
    expect(await store.get()).toBeNull();
  });
});
