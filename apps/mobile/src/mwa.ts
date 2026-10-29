import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { Web3MobileWallet } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import type { TransactionSigner } from "@musebook/wallet";

/**
 * Mobile Wallet Adapter signing. Every signature happens in the user's wallet
 * app (Seed Vault, Phantom, Solflare, ...) via `transact`; this app never
 * holds, derives or stores a private key.
 */
export type Transact = <T>(cb: (wallet: Web3MobileWallet) => Promise<T>) => Promise<T>;
export type MwaChain = "solana:devnet" | "solana:mainnet";

export const APP_IDENTITY = { name: "musebook agents", uri: "https://musebook.trade", icon: "favicon.ico" } as const;

export const chainFor = (network: "devnet" | "mainnet-beta"): MwaChain => (network === "devnet" ? "solana:devnet" : "solana:mainnet");

/** MWA returns account addresses as base64 public-key bytes. */
export const addressToBase58 = (b64: string) => new PublicKey(Buffer.from(b64, "base64")).toBase58();

const deserialize = (bytes: Uint8Array) => {
  try { return VersionedTransaction.deserialize(bytes); } catch { return Transaction.from(bytes); }
};

export interface MwaSession { publicKey: string; authToken: string }

async function authorize(wallet: Web3MobileWallet, chain: MwaChain, authToken?: string): Promise<MwaSession> {
  const r = await wallet.authorize({ identity: APP_IDENTITY, chain, ...(authToken ? { auth_token: authToken } : {}) });
  const account = r.accounts[0];
  if (!account) throw new Error("The wallet returned no account.");
  return { publicKey: addressToBase58(account.address), authToken: r.auth_token };
}

export const connect = (transact: Transact, chain: MwaChain, authToken?: string) =>
  transact((wallet) => authorize(wallet, chain, authToken));

/** Sign (not send) transactions in the wallet. */
export function signInWallet<T extends Transaction | VersionedTransaction>(transact: Transact, chain: MwaChain, session: MwaSession, txs: T[]) {
  return transact(async (wallet) => {
    await authorize(wallet, chain, session.authToken);
    return wallet.signTransactions({ transactions: txs });
  });
}

/** Adapt MWA to the SDK's TransactionSigner so SDK flows (registerIdentity) ask the wallet. */
export function mwaSigner(transact: Transact, chain: MwaChain, session: MwaSession): TransactionSigner {
  return {
    publicKey: session.publicKey,
    async signMessage(message) {
      return transact(async (wallet) => {
        const s = await authorize(wallet, chain, session.authToken);
        const address = Buffer.from(new PublicKey(s.publicKey).toBytes()).toString("base64");
        const [sig] = await wallet.signMessages({ addresses: [address], payloads: [message] });
        return sig;
      });
    },
    async signTransaction(transactionBase64) {
      const [signed] = await signInWallet(transact, chain, session, [deserialize(Buffer.from(transactionBase64, "base64"))]);
      const bytes = signed instanceof Transaction ? signed.serialize({ requireAllSignatures: false }) : signed.serialize();
      return Buffer.from(bytes).toString("base64");
    },
  };
}
