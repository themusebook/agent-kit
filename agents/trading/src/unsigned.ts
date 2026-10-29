import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

export type Network = "devnet" | "mainnet-beta";

export interface UnsignedTx {
  kind: "unsigned-transaction";
  network: Network;
  feePayer: string;
  recentBlockhash: string;
  base64: string;
  requiredSigners: string[];
  partiallySignedBy: string[];
  description: string;
}

export interface BuildUnsignedTxInput {
  network: Network;
  feePayer: PublicKey;
  recentBlockhash: string;
  instructions: TransactionInstruction[];
  description: string;
  ephemeralMint?: Keypair;
}

/**
 * Compile instructions into a v0 transaction the user's wallet signs.
 * The only key this ever touches is an ephemeral in-memory mint keypair,
 * which co-signs a launch and is never returned, logged or persisted.
 */
export function buildUnsignedTx(input: BuildUnsignedTxInput): UnsignedTx {
  if (input.instructions.length === 0) throw new Error("no instructions to sign");
  const message = new TransactionMessage({
    payerKey: input.feePayer,
    recentBlockhash: input.recentBlockhash,
    instructions: input.instructions,
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  const partiallySignedBy: string[] = [];
  if (input.ephemeralMint) {
    tx.sign([input.ephemeralMint]);
    partiallySignedBy.push(input.ephemeralMint.publicKey.toBase58());
  }
  const n = message.header.numRequiredSignatures;
  const requiredSigners = message.staticAccountKeys
    .slice(0, n)
    .map((k) => k.toBase58())
    .filter((k) => !partiallySignedBy.includes(k));
  return {
    kind: "unsigned-transaction",
    network: input.network,
    feePayer: input.feePayer.toBase58(),
    recentBlockhash: input.recentBlockhash,
    base64: Buffer.from(tx.serialize()).toString("base64"),
    requiredSigners,
    partiallySignedBy,
    description: input.description,
  };
}

/** A fresh mint keypair for one launch. Kept in memory only; callers must drop it after buildUnsignedTx. */
export function ephemeralMintKeypair(): Keypair {
  return Keypair.generate();
}

export function decodeUnsignedTx(base64: string): VersionedTransaction {
  return VersionedTransaction.deserialize(Buffer.from(base64, "base64"));
}

const SECRET_KEYS = /(secret|private)[-_]?key|seed[-_]?phrase|mnemonic|keypair/i;

/** Refuse any input object that looks like it carries key material. */
export function assertNoSecrets(input: unknown, path = "input"): void {
  if (input === null || typeof input !== "object") return;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SECRET_KEYS.test(k)) throw new Error(`${path}.${k}: the kit never accepts private keys; pass a public key and sign in your wallet`);
    if (v instanceof Uint8Array && v.length === 64) throw new Error(`${path}.${k}: 64-byte array looks like a secret key; refused`);
    assertNoSecrets(v, `${path}.${k}`);
  }
}

export function networkFromEnv(env: Record<string, string | undefined> = process.env): Network {
  return env.SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
}
