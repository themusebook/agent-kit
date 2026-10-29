import { Connection, Transaction, VersionedTransaction } from "@solana/web3.js";
import { buildRegistrationDocument, registerIdentity, resolveAgent, validateRegistrationDocument } from "@themusebook/agent-kit-identity";
import { buildAtomicBatch, type BatchItem } from "@themusebook/agent-kit-payments";
import { walletSigner, toBase64, type InjectedSolanaProvider } from "./wallet";

/** All chain reads and sends go through the /rpc proxy (keyed RPC stays server-side). */
export const RPC_PATH = "/rpc";
export const rpcUrl = (origin: string) => new URL(RPC_PATH, origin).toString();

export function deserializeAny(bytes: Uint8Array) {
  try { return VersionedTransaction.deserialize(bytes); } catch { return Transaction.from(bytes); }
}

export const readIdentity = (rpc: string, asset: string) => resolveAgent({ rpc }, asset);

/**
 * Build an UNSIGNED atomic-batch payment. Returns the transaction and its
 * base64 form; nothing is signed or sent here.
 */
export function buildUnsignedPayment(payer: string, items: BatchItem[], recentBlockhash: string) {
  const { transaction } = buildAtomicBatch({ payer, items, recentBlockhash });
  const base64 = toBase64(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }));
  return { transaction, base64 };
}

/** Hand an unsigned transaction to the user's wallet, then broadcast what the wallet returned. */
export async function signInWalletAndSend(provider: InjectedSolanaProvider, rpc: string, tx: Transaction) {
  const signed = await provider.signTransaction(tx);
  return new Connection(rpc, "confirmed").sendRawTransaction(signed.serialize());
}

export async function payWithWallet(provider: InjectedSolanaProvider, rpc: string, items: BatchItem[]) {
  const { publicKey } = await provider.connect();
  const { blockhash } = await new Connection(rpc, "confirmed").getLatestBlockhash();
  const { transaction } = buildUnsignedPayment(publicKey.toBase58(), items, blockhash);
  return signInWalletAndSend(provider, rpc, transaction);
}

/** Registration document to pin (ipfs://) before minting. Pure; no network. */
export function registrationDraft(name: string, description: string, image: string) {
  const doc = buildRegistrationDocument({ name, description, image });
  return { doc, errors: validateRegistrationDocument(doc) };
}

/**
 * Mint a Metaplex agent identity. The hosted API returns an unsigned tx; the
 * SDK asks the user's wallet (through walletSigner) to sign it.
 */
export async function mintWithWallet(
  provider: InjectedSolanaProvider, rpc: string, network: "devnet" | "mainnet-beta", name: string, metadataUri: string,
) {
  if (!/^ipfs:\/\//.test(metadataUri)) throw new Error("Pin the registration document first and use its ipfs:// URI.");
  const signer = await walletSigner(provider, deserializeAny);
  return registerIdentity({ rpc, network }, { signer, name, metadataUri });
}
