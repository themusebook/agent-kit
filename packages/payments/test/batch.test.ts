import { describe, expect, it } from "vitest";
import { buildAtomicBatch, MAX_BATCH_RECIPIENTS } from "../src/batch";
import { Keypair } from "@solana/web3.js";

const kp = () => Keypair.generate().publicKey.toBase58();
const item = () => ({
  source: kp(),
  destination: kp(),
  mint: kp(),
  amount: "1000",
  decimals: 6,
});

describe("buildAtomicBatch", () => {
  it("builds one TransferChecked per recipient, payer as fee payer", () => {
    const payer = kp();
    const batch = buildAtomicBatch({ payer, items: [item(), item()] });
    expect(batch.itemCount).toBe(2);
    expect(batch.transaction.instructions).toHaveLength(2);
    expect(batch.transaction.feePayer?.toBase58()).toBe(payer);
    for (const ix of batch.transaction.instructions) {
      expect(ix.programId.toBase58()).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
      expect(ix.data[0]).toBe(12); // TransferChecked discriminator
    }
  });

  it("enforces the 1–8 recipient bound", () => {
    const payer = kp();
    expect(() => buildAtomicBatch({ payer, items: [] })).toThrow(/1–8/);
    expect(() =>
      buildAtomicBatch({
        payer,
        items: Array.from({ length: MAX_BATCH_RECIPIENTS + 1 }, item),
      }),
    ).toThrow(/1–8/);
  });
});
