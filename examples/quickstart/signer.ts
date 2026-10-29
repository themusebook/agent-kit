/**
 * Example-only signer: loads YOUR throwaway DEVNET keypair file.
 * This is example code, not the kit — the kit itself never holds keys.
 * Never point this at a mainnet keypair.
 */
import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";

export function devnetSigner() {
  const path = process.env.AGENT_KEYPAIR ?? "./devnet-agent-keypair.json";
  const secret = JSON.parse(readFileSync(path, "utf8")) as number[];
  const kp = Keypair.fromSecretKey(new Uint8Array(secret));
  return {
    publicKey: kp.publicKey.toBase58(),
    async signMessage(message: Uint8Array): Promise<Uint8Array> {
      const { sign } = await import("tweetnacl");
      return sign.detached(message, kp.secretKey);
    },
    async signTransaction(txBase64: string): Promise<string> {
      const { Transaction, VersionedTransaction } = await import("@solana/web3.js");
      const bytes = Buffer.from(txBase64, "base64");
      try {
        const vtx = VersionedTransaction.deserialize(bytes);
        vtx.sign([kp]);
        return Buffer.from(vtx.serialize()).toString("base64");
      } catch {
        const tx = Transaction.from(bytes);
        tx.partialSign(kp);
        return Buffer.from(tx.serialize({ requireAllSignatures: false })).toString("base64");
      }
    },
  };
}
