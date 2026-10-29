import type { TransactionSigner } from "@themusebook/agent-kit-wallet";

/**
 * The user's own browser wallet (Phantom or any wallet injecting the same
 * provider shape). The app never sees a private key: it hands unsigned
 * transactions to the wallet, which shows its own approval prompt.
 */
export interface InjectedSolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect?(): Promise<void>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  signTransaction<T>(transaction: T): Promise<T>;
}

type WalletWindow = { phantom?: { solana?: InjectedSolanaProvider }; solana?: InjectedSolanaProvider };

export function findProvider(win: unknown = globalThis): InjectedSolanaProvider | null {
  const w = win as WalletWindow;
  return w.phantom?.solana ?? w.solana ?? null;
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Adapt the injected wallet to the SDK's TransactionSigner so SDK flows
 * (e.g. registerIdentity) ask the user's wallet for every signature.
 */
export async function walletSigner(
  provider: InjectedSolanaProvider,
  deserialize: (bytes: Uint8Array) => { serialize(opts?: { requireAllSignatures?: boolean }): Uint8Array },
): Promise<TransactionSigner> {
  const { publicKey } = await provider.connect();
  return {
    publicKey: publicKey.toBase58(),
    async signMessage(message) {
      if (!provider.signMessage) throw new Error("This wallet cannot sign messages.");
      return (await provider.signMessage(message)).signature;
    },
    async signTransaction(transactionBase64) {
      const signed = await provider.signTransaction(deserialize(fromBase64(transactionBase64)));
      return toBase64(signed.serialize({ requireAllSignatures: false }));
    },
  };
}

export { toBase64, fromBase64 };
