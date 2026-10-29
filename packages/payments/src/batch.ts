import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

/**
 * Atomic-batch payload builder (x402 `atomic-batch` SVM scheme, upstream
 * as solana-foundation/x402 PR #75): ONE client-signed transaction paying
 * 1–8 recipients atomically — every transfer lands or none do. The payer
 * is fee payer and sole signer; a facilitator only verifies, simulates
 * and broadcasts.
 *
 * This module BUILDS the unsigned transaction only. It never broadcasts.
 * Instruction allowlist: SPL Token `TransferChecked` only. Token-2022 is
 * out of scope for the scheme.
 */

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const MAX_BATCH_RECIPIENTS = 8;

export interface BatchItem {
  /** Source token account (owned by the payer). */
  source: string;
  /** Destination token account. */
  destination: string;
  /** Token mint (shared across items in the reference scheme use). */
  mint: string;
  /** Amount in base units. */
  amount: string | number | bigint;
  /** Mint decimals, required by TransferChecked. */
  decimals: number;
}

export interface AtomicBatch {
  kind: "atomic-batch";
  /** Number of TransferChecked instructions == number of items. */
  itemCount: number;
  items: BatchItem[];
  /** Unsigned legacy transaction; feePayer = payer, no blockhash set yet unless provided. */
  transaction: Transaction;
}

/** SPL Token TransferChecked instruction (discriminator 12). */
export function transferCheckedInstruction(
  item: BatchItem,
  owner: PublicKey,
): TransactionInstruction {
  const amount = BigInt(item.amount);
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0); // TransferChecked
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(item.decimals, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(item.source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(item.mint), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(item.destination), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export function buildAtomicBatch(input: {
  payer: string;
  items: BatchItem[];
  recentBlockhash?: string;
}): AtomicBatch {
  if (input.items.length < 1 || input.items.length > MAX_BATCH_RECIPIENTS) {
    throw new Error(
      `atomic-batch carries 1–${MAX_BATCH_RECIPIENTS} recipients; got ${input.items.length}`,
    );
  }
  const payer = new PublicKey(input.payer);
  const tx = new Transaction({ feePayer: payer });
  if (input.recentBlockhash) tx.recentBlockhash = input.recentBlockhash;
  for (const item of input.items) {
    tx.add(transferCheckedInstruction(item, payer));
  }
  return { kind: "atomic-batch", itemCount: input.items.length, items: input.items, transaction: tx };
}
