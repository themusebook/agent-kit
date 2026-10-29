import { Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { addressToBase58, chainFor, connect, mwaSigner, signInWallet, type Transact } from "../src/mwa";
import { buildUnsignedPayment, mintWithWallet } from "../src/actions";

// A stand-in for the wallet app. The test holds a key only to play the wallet's part.
function fakeWallet() {
  const key = Keypair.generate();
  const calls: { method: string; params: any }[] = [];
  const wallet = {
    async authorize(params: any) {
      calls.push({ method: "authorize", params });
      return { accounts: [{ address: Buffer.from(key.publicKey.toBytes()).toString("base64") }], auth_token: "tok", wallet_uri_base: "" };
    },
    async signTransactions({ transactions }: { transactions: (Transaction | VersionedTransaction)[] }) {
      calls.push({ method: "signTransactions", params: transactions.length });
      return transactions.map((t) => { if (t instanceof Transaction) t.partialSign(key); else t.sign([key]); return t; });
    },
    async signMessages({ payloads }: { payloads: Uint8Array[] }) {
      calls.push({ method: "signMessages", params: payloads.length });
      return payloads.map(() => new Uint8Array(64));
    },
  };
  const transact: Transact = (cb) => cb(wallet as any);
  return { key, calls, transact };
}

const tx = (payer: PublicKey) => {
  const t = new Transaction({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111" });
  t.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  return t;
};
const pk = () => Keypair.generate().publicKey.toBase58();

describe("MWA", () => {
  it("maps networks to MWA chains", () => {
    expect(chainFor("devnet")).toBe("solana:devnet");
    expect(chainFor("mainnet-beta")).toBe("solana:mainnet");
  });
  it("decodes base64 account addresses", () => {
    const k = Keypair.generate().publicKey;
    expect(addressToBase58(Buffer.from(k.toBytes()).toString("base64"))).toBe(k.toBase58());
  });
  it("connects with the app identity and chain", async () => {
    const w = fakeWallet();
    const s = await connect(w.transact, "solana:devnet");
    expect(s).toEqual({ publicKey: w.key.publicKey.toBase58(), authToken: "tok" });
    expect(w.calls[0].params).toMatchObject({ chain: "solana:devnet", identity: { name: "musebook agents" } });
  });
  it("signs in the wallet, reusing the auth token", async () => {
    const w = fakeWallet();
    const s = await connect(w.transact, "solana:devnet");
    const [signed] = await signInWallet(w.transact, "solana:devnet", s, [tx(w.key.publicKey)]);
    expect(signed.verifySignatures()).toBe(true);
    expect(w.calls[1].params.auth_token).toBe("tok");
  });
  it("adapts to the SDK signer (base64 in, wallet-signed base64 out)", async () => {
    const w = fakeWallet();
    const signer = mwaSigner(w.transact, "solana:devnet", await connect(w.transact, "solana:devnet"));
    const unsigned = tx(w.key.publicKey).serialize({ requireAllSignatures: false }).toString("base64");
    const out = VersionedTransaction.deserialize(Buffer.from(await signer.signTransaction(unsigned), "base64"));
    expect(out.signatures[0].some((b) => b !== 0)).toBe(true);
    expect(await signer.signMessage(new Uint8Array([1]))).toHaveLength(64);
  });
  it("builds payments unsigned", () => {
    const t = buildUnsignedPayment(pk(), [{ source: pk(), destination: pk(), mint: pk(), amount: 1000n, decimals: 6 }], "11111111111111111111111111111111");
    expect(t.signatures.every((s) => s.signature === null)).toBe(true);
  });
  it("refuses to mint without a pinned ipfs URI", async () => {
    const w = fakeWallet();
    await expect(mintWithWallet(w.transact, "devnet", { publicKey: w.key.publicKey.toBase58(), authToken: "tok" }, "https://a.io/rpc", "n", "https://x")).rejects.toThrow(/ipfs/);
  });
});
