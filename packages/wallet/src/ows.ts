import { PublicKey } from "@solana/web3.js";

/**
 * Signer interfaces. The kit NEVER holds keys: every signature is produced
 * by a caller-supplied signer — typically an Open Wallet Standard (OWS)
 * wallet accessed through a scoped, policy-gated API-key delegation.
 */

export interface MessageSigner {
  /** Base58 Solana public key of the signing wallet. */
  readonly publicKey: string;
  /** Sign an arbitrary message (SIWS challenges, agent tokens). */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface TransactionSigner extends MessageSigner {
  /**
   * Sign a serialized (base64) transaction and return it base64-encoded.
   * Sign-only: broadcasting is the caller's (or the kit's RPC helper's) job.
   */
  signTransaction(transactionBase64: string): Promise<string>;
}

export function isTransactionSigner(s: MessageSigner): s is TransactionSigner {
  return typeof (s as TransactionSigner).signTransaction === "function";
}

/** Declarative OWS delegation policy (mirrors the Muse wallet policy shape). */
export interface OwsPolicy {
  id: string;
  name: string;
  version: number;
  rules: OwsPolicyRule[];
}

export type OwsPolicyRule =
  | { type: "allowed_chains"; chainIds: string[] }
  | { type: "expires_at"; expiresAt: string }
  | { type: string; [key: string]: unknown };

/**
 * Adapter interface for an OWS-backed signer. Implementations live outside
 * the kit (the `ows` CLI / SDK in the operator's environment); the kit only
 * consumes this surface. A policy rejection from `signMessage` /
 * `signTransaction` is a FINAL denial — callers must not retry around it.
 */
export interface OwsSignerAdapter extends TransactionSigner {
  readonly walletName: string;
  getPolicy(): Promise<OwsPolicy | null>;
  /** Public key as a web3.js PublicKey. */
  solanaPublicKey(): PublicKey;
}

/** Convenience: bs58/base64 encodings used across the kit. */
export function signatureToBase64(sig: Uint8Array): string {
  return Buffer.from(sig).toString("base64");
}
