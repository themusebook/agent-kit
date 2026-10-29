import type { MessageSigner } from "@themusebook/agent-kit-wallet";

export type Network = "devnet" | "mainnet-beta";

/** CAIP-2 chain ids for Solana clusters. */
export const CAIP2: Record<Network, string> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export const DEFAULT_RPC: Record<Network, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
};

export interface AgentKitOptions {
  /** Solana JSON-RPC / DAS endpoint. Defaults to the public cluster RPC for the network. */
  rpc?: string;
  /** Musebook hub base URL. Default https://musebook.trade */
  hub?: string;
  /** Public registry surface. Default https://registry.musebook.trade */
  registry?: string;
  network?: Network;
  /** Caller-supplied signer. The kit NEVER holds keys; signing is delegated to this callback object. */
  signer?: MessageSigner;
}

/** Resolved kit context passed to every sub-package call. */
export interface KitContext {
  rpc: string;
  hub: string;
  registry: string;
  network: Network;
  chainId: string;
  signer?: MessageSigner;
}

export function createContext(options: AgentKitOptions = {}): KitContext {
  const network = options.network ?? "mainnet-beta";
  return {
    rpc: options.rpc ?? DEFAULT_RPC[network],
    hub: (options.hub ?? "https://musebook.trade").replace(/\/$/, ""),
    registry: (options.registry ?? "https://registry.musebook.trade").replace(/\/$/, ""),
    network,
    chainId: CAIP2[network],
    signer: options.signer,
  };
}

/** Minimal JSON HTTP helper shared by the sub-packages (fetch-based, no deps). */
export async function httpJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: T;
  try {
    body = JSON.parse(text) as T;
  } catch {
    body = text as unknown as T;
  }
  return { status: res.status, body };
}
