import { Network } from "./types";

// CDP Network IDs
export const SOLANA_MAINNET_NETWORK_ID = "solana-mainnet";
export const SOLANA_TESTNET_NETWORK_ID = "solana-testnet";
export const SOLANA_DEVNET_NETWORK_ID = "solana-devnet";
export type SOLANA_NETWORK_ID =
  | typeof SOLANA_MAINNET_NETWORK_ID
  | typeof SOLANA_TESTNET_NETWORK_ID
  | typeof SOLANA_DEVNET_NETWORK_ID;
export const SOLANA_NETWORK_IDS: SOLANA_NETWORK_ID[] = [
  SOLANA_MAINNET_NETWORK_ID,
  SOLANA_TESTNET_NETWORK_ID,
  SOLANA_DEVNET_NETWORK_ID,
];

// AgentKit Protocol Family
export const SOLANA_PROTOCOL_FAMILY = "svm";

// Chain IDs - Genesis Block Hashes
export const SOLANA_MAINNET_GENESIS_BLOCK_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export const SOLANA_TESTNET_GENESIS_BLOCK_HASH = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
export const SOLANA_DEVNET_GENESIS_BLOCK_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export type SOLANA_CLUSTER =
  | typeof SOLANA_MAINNET_GENESIS_BLOCK_HASH
  | typeof SOLANA_TESTNET_GENESIS_BLOCK_HASH
  | typeof SOLANA_DEVNET_GENESIS_BLOCK_HASH;

export const SOLANA_MAINNET_NETWORK: Network = {
  protocolFamily: SOLANA_PROTOCOL_FAMILY,
  chainId: SOLANA_MAINNET_GENESIS_BLOCK_HASH,
  networkId: SOLANA_MAINNET_NETWORK_ID,
};

export const SOLANA_TESTNET_NETWORK: Network = {
  protocolFamily: SOLANA_PROTOCOL_FAMILY,
  chainId: SOLANA_TESTNET_GENESIS_BLOCK_HASH,
  networkId: SOLANA_TESTNET_NETWORK_ID,
};

export const SOLANA_DEVNET_NETWORK: Network = {
  protocolFamily: SOLANA_PROTOCOL_FAMILY,
  chainId: SOLANA_DEVNET_GENESIS_BLOCK_HASH,
  networkId: SOLANA_DEVNET_NETWORK_ID,
};

export const SOLANA_NETWORKS: Record<SOLANA_CLUSTER, Network> = {
  [SOLANA_MAINNET_GENESIS_BLOCK_HASH]: SOLANA_MAINNET_NETWORK,
  [SOLANA_TESTNET_GENESIS_BLOCK_HASH]: SOLANA_TESTNET_NETWORK,
  [SOLANA_DEVNET_GENESIS_BLOCK_HASH]: SOLANA_DEVNET_NETWORK,
};

export const SOLANA_CLUSTER_ID_BY_NETWORK_ID: Record<SOLANA_NETWORK_ID, string> = {
  [SOLANA_MAINNET_NETWORK_ID]: "mainnet-beta",
  [SOLANA_TESTNET_NETWORK_ID]: "testnet",
  [SOLANA_DEVNET_NETWORK_ID]: "devnet",
};

// Musebook Agent Kit safety: devnet by default, mainnet behind an explicit opt-in flag.
export const DEFAULT_SOLANA_NETWORK_ID: SOLANA_NETWORK_ID = SOLANA_DEVNET_NETWORK_ID;
export const MAINNET_FLAG_ENV = "MUSEBOOK_ENABLE_MAINNET";

/**
 * Whether Solana mainnet is enabled. Defaults to false; set MUSEBOOK_ENABLE_MAINNET=true to opt in.
 *
 * @returns true only when the opt-in flag is exactly "true"
 */
export function isMainnetEnabled(): boolean {
  return typeof process !== "undefined" && process.env?.[MAINNET_FLAG_ENV] === "true";
}

/**
 * Throws unless mainnet has been explicitly enabled.
 *
 * @param genesisHashOrNetworkId - genesis hash or network id about to be used
 */
export function assertSolanaNetworkAllowed(genesisHashOrNetworkId: string): void {
  const isMainnet =
    genesisHashOrNetworkId === SOLANA_MAINNET_GENESIS_BLOCK_HASH ||
    genesisHashOrNetworkId === SOLANA_MAINNET_NETWORK_ID;
  if (isMainnet && !isMainnetEnabled()) {
    throw new Error(
      `Solana mainnet is disabled by default. Set ${MAINNET_FLAG_ENV}=true to opt in (devnet is the default).`,
    );
  }
}
