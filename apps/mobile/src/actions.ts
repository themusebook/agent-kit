import { Connection } from "@solana/web3.js";
import { buildRegistrationDocument, registerIdentity, resolveAgent, validateRegistrationDocument } from "@musebook/identity";
import { buildAtomicBatch, type BatchItem } from "@musebook/payments";
import { chainFor, mwaSigner, signInWallet, type MwaSession, type Transact } from "./mwa";

export const readIdentity = (rpc: string, asset: string) => resolveAgent({ rpc }, asset);

export function registrationDraft(name: string, description: string, image: string) {
  const doc = buildRegistrationDocument({ name, description, image });
  return { doc, errors: validateRegistrationDocument(doc) };
}

/** UNSIGNED atomic-batch payment; nothing is signed or sent here. */
export const buildUnsignedPayment = (payer: string, items: BatchItem[], recentBlockhash: string) =>
  buildAtomicBatch({ payer, items, recentBlockhash }).transaction;

export async function payWithWallet(transact: Transact, network: "devnet" | "mainnet-beta", session: MwaSession, rpc: string, items: BatchItem[]) {
  const connection = new Connection(rpc, "confirmed");
  const { blockhash } = await connection.getLatestBlockhash();
  const [signed] = await signInWallet(transact, chainFor(network), session, [buildUnsignedPayment(session.publicKey, items, blockhash)]);
  return connection.sendRawTransaction(signed.serialize());
}

export async function mintWithWallet(
  transact: Transact, network: "devnet" | "mainnet-beta", session: MwaSession, rpc: string, name: string, metadataUri: string,
) {
  if (!/^ipfs:\/\//.test(metadataUri)) throw new Error("Pin the registration document first and use its ipfs:// URI.");
  return registerIdentity({ rpc, network }, { signer: mwaSigner(transact, chainFor(network), session), name, metadataUri });
}
