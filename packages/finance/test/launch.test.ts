import { describe, expect, it, vi } from "vitest";
import { deriveAssetSignerPda } from "@themusebook/agent-kit-identity";
import {
  buildCreateAndRegisterLaunch,
  createGenesisHttpAdapter,
  GENESIS_LAUNCH_URL,
  validateGenesisTokenMetadata,
  type CreateAndRegisterLaunchInput,
} from "../src/launch";
import {
  isGenesisApiError,
  isGenesisApiNetworkError,
  isGenesisValidationError,
} from "../src/errors";

const WALLET = "GxVrpqBsnSbFbbBqtSSkx8qrTHyeKubS9vMdGnW4N2e";
const AGENT = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";

const goodInput: CreateAndRegisterLaunchInput = {
  wallet: WALLET,
  agent: { mint: AGENT, setToken: true },
  token: {
    name: "RWA Agent Token",
    symbol: "RWAA",
    image: "https://gateway.irys.xyz/your-image",
    description: "Token of an RWA agent",
  },
};

describe("buildCreateAndRegisterLaunch", () => {
  it("shapes the documented Genesis payload", () => {
    const p = buildCreateAndRegisterLaunch(goodInput);
    expect(p.endpoint).toBe(GENESIS_LAUNCH_URL);
    expect(p.endpoint).toBe("https://api.metaplex.com/v1/genesis/launch");
    expect(p.body.launchType).toBe("bondingCurve");
    expect(p.body.agent).toEqual({ mint: AGENT, setToken: true });
    expect(p.body.wallet).toBe(WALLET);
  });

  it("routes creator fees to the Asset Signer PDA by default", () => {
    const p = buildCreateAndRegisterLaunch(goodInput);
    expect(p.creatorFeeWallet).toBe(deriveAssetSignerPda(AGENT).toBase58());
    const override = buildCreateAndRegisterLaunch({ ...goodInput, creatorFeeWallet: WALLET });
    expect(override.creatorFeeWallet).toBe(WALLET);
  });

  it("warns on the permanent bind, and harder on devnet", () => {
    const p = buildCreateAndRegisterLaunch(goodInput);
    expect(p.warnings.join(" ")).toMatch(/PERMANENTLY binds/);
    const dev = buildCreateAndRegisterLaunch({ ...goodInput, network: "solana-devnet" });
    expect(dev.warnings.join(" ")).toMatch(/devnet guidance/);
    const noBind = buildCreateAndRegisterLaunch({
      ...goodInput,
      agent: { mint: AGENT, setToken: false },
    });
    expect(noBind.warnings).toEqual([]);
  });

  it("validates token metadata bounds", () => {
    const fields = (t: CreateAndRegisterLaunchInput["token"]) =>
      validateGenesisTokenMetadata(t).map((p) => p.field);
    expect(fields(goodInput.token)).toEqual([]);
    expect(fields({ ...goodInput.token, name: "" })).toContain("token.name");
    expect(fields({ ...goodInput.token, name: "x".repeat(33) })).toContain("token.name");
    expect(fields({ ...goodInput.token, symbol: "WAYTOOLONGSYM" })).toContain("token.symbol");
    expect(fields({ ...goodInput.token, description: "d".repeat(251) })).toContain(
      "token.description",
    );
  });

  it("requires an Irys gateway image URL", () => {
    expect(
      validateGenesisTokenMetadata({ ...goodInput.token, image: "https://example.com/i.png" }).map(
        (p) => p.field,
      ),
    ).toContain("token.image");
    expect(() =>
      buildCreateAndRegisterLaunch({
        ...goodInput,
        token: { ...goodInput.token, image: "ipfs://bafyimage" },
      }),
    ).toThrowError(/Irys/);
    try {
      buildCreateAndRegisterLaunch({
        ...goodInput,
        token: { ...goodInput.token, image: "https://example.com/i.png" },
      });
      expect.unreachable();
    } catch (e) {
      expect(isGenesisValidationError(e)).toBe(true);
      expect((e as { field: string }).field).toBe("token.image");
    }
  });
});

describe("createGenesisHttpAdapter error taxonomy", () => {
  it("maps non-2xx to GenesisApiError and network failure to GenesisApiNetworkError", async () => {
    const payload = buildCreateAndRegisterLaunch(goodInput);
    const failing = createGenesisHttpAdapter(
      vi.fn(async () => new Response("nope", { status: 422 })) as unknown as typeof fetch,
    );
    await expect(failing.submit(payload)).rejects.toSatisfy(
      (e: unknown) => isGenesisApiError(e) && e.statusCode === 422,
    );
    const offline = createGenesisHttpAdapter(
      vi.fn(async () => {
        throw new Error("dns");
      }) as unknown as typeof fetch,
    );
    await expect(offline.submit(payload)).rejects.toSatisfy((e: unknown) =>
      isGenesisApiNetworkError(e),
    );
  });

  it("returns the submission on success", async () => {
    const payload = buildCreateAndRegisterLaunch(goodInput);
    const ok = createGenesisHttpAdapter(
      vi.fn(
        async () =>
          new Response(JSON.stringify({ signature: "sig", launch: "launchAddr" }), {
            status: 200,
          }),
      ) as unknown as typeof fetch,
    );
    await expect(ok.submit(payload)).resolves.toMatchObject({
      signature: "sig",
      launch: "launchAddr",
    });
  });
});
