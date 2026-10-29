/**
 * Paid tool — the agent-commerce shape (ARCHITECTURE §6).
 *
 * A tool is published behind an x402 gate; callers pay per request in USDC
 * and settlement lands in the agent's ASSET SIGNER PDA (the identity
 * treasury) — not in the service signer's wallet. Receipts are claims
 * until verified; the kit's verifyReceipt does that check.
 *
 * This example is the CALLER side + the pricing/gating contract, kept
 * framework-free so it drops into any HTTP handler.
 */
import { createAgentKit } from "@musebook/agent-kit";
import { deriveAssetSignerPda } from "@musebook/agent-kit";
import { devnetSigner } from "../quickstart/signer";

const MY_ASSET = process.env.AGENT_ASSET ?? "<your MPL Core asset address>";

// The treasury that receives this tool's revenue:
const treasury = deriveAssetSignerPda(MY_ASSET);
console.log("tool revenue settles to Asset Signer PDA:", treasury.toBase58());

// A 402 challenge a server would answer with (x402 v1 exact shape):
export const PRICE = {
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
      maxAmountRequired: "10000", // 0.01 USDC in base units
      asset: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC mint
      payTo: treasury.toBase58(),
      resource: "https://example.com/paid-tool",
      description: "One call to the paid tool",
    },
  ],
};

// Caller side: pay the challenge, then verify the receipt independently.
export async function callPaidTool() {
  const kit = createAgentKit({ network: "mainnet-beta", signer: devnetSigner() });
  const receipt = await kit.payments.payChallenge(
    { x402Version: 1, accepts: PRICE.accepts, raw: PRICE },
    async (requirement, signer) => ({
      scheme: requirement.scheme,
      // A real caller builds + signs the SVM exact payload (a token transfer
      // transaction) here, with ITS signer. The kit holds no keys.
      payload: { signedBy: signer.publicKey, note: "build the exact-scheme payload here" },
    }),
  );
  console.log("settled:", receipt.transaction, "verified:", receipt.verified);
  return receipt;
}
