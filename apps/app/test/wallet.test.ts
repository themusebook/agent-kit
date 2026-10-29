import { describe, expect, it } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { deserializeAny, buildUnsignedPayment, registrationDraft } from "../src/actions";
import { findProvider, walletSigner, toBase64, fromBase64, type InjectedSolanaProvider } from "../src/wallet";
import { serverProxy, DEFAULTS } from "../proxy.config";

// Test-only keypairs stand in for public addresses; the app itself never creates keys.
const payer = Keypair.generate().publicKey.toBase58();

describe("wallet", () => {
  it("finds Phantom first, then window.solana, else null", () => {
    const p = {} as InjectedSolanaProvider, s = {} as InjectedSolanaProvider;
    expect(findProvider({ phantom: { solana: p }, solana: s })).toBe(p);
    expect(findProvider({ solana: s })).toBe(s);
    expect(findProvider({})).toBeNull();
  });
  it("adapts the wallet to the SDK signer and routes signing to the wallet", async () => {
    const tx = new Transaction({ feePayer: Keypair.generate().publicKey, recentBlockhash: "11111111111111111111111111111111" })
      .add(SystemProgram.transfer({ fromPubkey: Keypair.generate().publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
    let walletAsked = 0;
    const provider: InjectedSolanaProvider = {
      connect: async () => ({ publicKey: { toBase58: () => payer } }),
      signTransaction: async (t) => { walletAsked++; return t; },
    };
    const signer = await walletSigner(provider, deserializeAny);
    expect(signer.publicKey).toBe(payer);
    const b64 = toBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
    expect(fromBase64(await signer.signTransaction(b64))).toBeInstanceOf(Uint8Array);
    expect(walletAsked).toBe(1);
    await expect(signer.signMessage(new Uint8Array([1]))).rejects.toThrow("cannot sign messages");
  });
});

describe("unsigned transactions", () => {
  it("payment batch is built unsigned", () => {
    const { transaction, base64 } = buildUnsignedPayment(payer, [{
      mint: Keypair.generate().publicKey.toBase58(), source: Keypair.generate().publicKey.toBase58(),
      destination: Keypair.generate().publicKey.toBase58(), amount: 1n, decimals: 6,
    }], "11111111111111111111111111111111");
    expect(transaction.signatures.every((s) => s.signature === null)).toBe(true);
    expect(base64.length).toBeGreaterThan(0);
  });
  it("registration draft validates", () => {
    expect(registrationDraft("musebot", "d", "ipfs://img").doc.name).toBe("musebot");
  });
});

describe("proxy", () => {
  it("keeps secrets in the proxy and uses documented defaults", () => {
    const p = serverProxy({});
    expect(p["/server"].target).toBe(DEFAULTS.SERVER_URL);
    expect(p["/server"].headers).toBeUndefined();
    expect(p["/rpc"].target).toBe(DEFAULTS.SOLANA_RPC_URL);
    expect(serverProxy({ WORKER_SHARED_SECRET: "s" })["/server"].headers).toEqual({ authorization: "Bearer s" });
    expect(p["/server"].rewrite("/server/api/agents")).toBe("/api/agents");
  });
});
