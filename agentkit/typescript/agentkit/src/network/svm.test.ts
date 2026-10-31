import {
  assertSolanaNetworkAllowed,
  DEFAULT_SOLANA_NETWORK_ID,
  isMainnetEnabled,
  SOLANA_MAINNET_GENESIS_BLOCK_HASH,
} from "./svm";

describe("Musebook Solana network safety", () => {
  const prev = process.env.MUSEBOOK_ENABLE_MAINNET;
  afterEach(() => {
    if (prev === undefined) delete process.env.MUSEBOOK_ENABLE_MAINNET;
    else process.env.MUSEBOOK_ENABLE_MAINNET = prev;
  });

  it("defaults to devnet", () => {
    expect(DEFAULT_SOLANA_NETWORK_ID).toBe("solana-devnet");
  });

  it("refuses mainnet unless the flag is true", () => {
    delete process.env.MUSEBOOK_ENABLE_MAINNET;
    expect(isMainnetEnabled()).toBe(false);
    expect(() => assertSolanaNetworkAllowed("solana-mainnet")).toThrow(/disabled by default/);
    expect(() => assertSolanaNetworkAllowed(SOLANA_MAINNET_GENESIS_BLOCK_HASH)).toThrow();
    expect(() => assertSolanaNetworkAllowed("solana-devnet")).not.toThrow();
    process.env.MUSEBOOK_ENABLE_MAINNET = "true";
    expect(() => assertSolanaNetworkAllowed("solana-mainnet")).not.toThrow();
  });
});
