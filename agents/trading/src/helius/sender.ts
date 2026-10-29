import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import type { FetchLike } from "../http.ts";
import { fetchWithRetry, HeliusError } from "./client.ts";

/** Browser-safe, keyless, CORS-enabled. */
export const SENDER_URL = "https://sender.helius-rpc.com/fast";
export const SENDER_TIP_ACCOUNTS = [
  "4ACfpUFoaSD9bfPdeu6DBt89gB6ENTeHBXCAi87NhDEE", "D2L6yPZ2FmmmTKPgzaMKdhu6EWZcTpLy1Vhx8uvZe7NZ", "9bnz4RShgq1hAnLnZbP8kbgBg1kEmcJBYQq3gQbmnSta",
  "5VY91ws6B2hMmBFRsXkoAAdsPHBJwRfBht4DXox3xkwn", "2nyhqdwKcJZR2vcqCyrYsaPVdAnFoJjiksCXJ7hfEYgD", "2q5pghRs6arqVjRvT5gfgWfWcHWmw1ZuCzphgd5KfWGJ",
  "wyvPkWjVZz1M8fHQnMMCDTQDbkManefNNhweYk5WkcF", "3KCKozbAaF75qEU33jtzozcJ29yJuaLJTy2jFdzUY8bT", "4vieeGHPYPG2MmyPRcYjdiDmmhN3ww7hsFNap8pVN3Ey",
  "4TQLFNWK8AovT1gFvda5jfw2oJeRMKEmw7aH6MGBJ3or",
];
/** Minimum tips per docs.helius.dev Sender page. */
export const MIN_TIP_LAMPORTS = { max: 1_000_000, swqosOnly: 5_000 } as const;

/**
 * Instructions to add before the user signs: compute-unit price from a
 * getPriorityFeeEstimate result, and a tip to a random Sender tip account (last).
 */
export function senderExtras(o: { payer: PublicKey; priorityFeeMicroLamports: number; computeUnits?: number; tipLamports?: number; swqosOnly?: boolean; random?: () => number }) {
  const min = o.swqosOnly ? MIN_TIP_LAMPORTS.swqosOnly : MIN_TIP_LAMPORTS.max;
  const tip = o.tipLamports ?? min;
  if (tip < min) throw new Error(`Sender tip must be at least ${min} lamports`);
  if (!Number.isFinite(o.priorityFeeMicroLamports) || o.priorityFeeMicroLamports < 0) throw new Error("priority fee must come from getPriorityFeeEstimate");
  const to = new PublicKey(SENDER_TIP_ACCOUNTS[Math.floor((o.random ?? Math.random)() * SENDER_TIP_ACCOUNTS.length)]!);
  return {
    prepend: [
      ...(o.computeUnits ? [ComputeBudgetProgram.setComputeUnitLimit({ units: o.computeUnits })] : []),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Math.ceil(o.priorityFeeMicroLamports) }),
    ] as TransactionInstruction[],
    append: [SystemProgram.transfer({ fromPubkey: o.payer, toPubkey: to, lamports: tip })] as TransactionInstruction[],
  };
}

/** Largest tip in a compiled tx to a Sender tip account (static keys only). */
export function tipLamports(tx: VersionedTransaction): number {
  const keys = tx.message.staticAccountKeys;
  let best = 0;
  for (const ix of tx.message.compiledInstructions) {
    if (!keys[ix.programIdIndex]?.equals(SystemProgram.programId)) continue;
    const data = Buffer.from(ix.data);
    if (data.length < 12 || data.readUInt32LE(0) !== 2) continue;
    const dest = keys[ix.accountKeyIndexes[1]!];
    if (dest && SENDER_TIP_ACCOUNTS.includes(dest.toBase58())) best = Math.max(best, Number(data.readBigUInt64LE(4)));
  }
  return best;
}

/** Rejects anything the user has not fully signed, or that lacks a Sender tip. */
export function checkSignedForSender(base64: string, swqosOnly = false): VersionedTransaction {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
  const need = tx.message.header.numRequiredSignatures;
  if (tx.signatures.length < need || tx.signatures.slice(0, need).some((s) => s.every((b) => b === 0))) throw new Error("transaction is not fully signed; the user's wallet must sign before Sender");
  const min = swqosOnly ? MIN_TIP_LAMPORTS.swqosOnly : MIN_TIP_LAMPORTS.max;
  if (tipLamports(tx) < min) throw new Error(`no Sender tip of at least ${min} lamports to a Sender tip account`);
  return tx;
}

/** Submit an already user-signed transaction. Sender is keyless; nothing here signs. */
export async function sendSigned(base64: string, o: { swqosOnly?: boolean; fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {}): Promise<string> {
  checkSignedForSender(base64, o.swqosOnly);
  const url = o.swqosOnly ? `${SENDER_URL}?swqos_only=true` : SENDER_URL;
  // maxAttempts 1: re-sending is the caller's decision after checking the signature status.
  const res = await fetchWithRetry(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "musebook", method: "sendTransaction", params: [base64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }),
  }, { ...o, maxAttempts: 1 });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || body?.error) throw new HeliusError(res.status, `Sender: ${JSON.stringify(body?.error ?? body)}`);
  return body.result as string;
}
