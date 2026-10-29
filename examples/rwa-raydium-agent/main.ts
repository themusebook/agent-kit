/**
 * RWA + Raydium agent (devnet).
 *
 * Combines Solizardking/solana-rwa-agents (program `rwa_tokenization`, devnet
 * 8CM5WK2EXXY9goXaTRnmKvFAxiSfVAmmTWBVX7X5zvBc) with the clawd pump/Raydium
 * backend (Solizardking/clawd-pump-hybrid, branch feat/rwa-agents):
 *
 *   1. register an RWA owned by the agent's Asset Signer PDA (Core execute)
 *   2. tokenize it into an SPL mint
 *   3. trade the mint on the clawd AMM / Raydium
 *   4. pay for x402 inference from the same Asset Signer PDA (coreExecute)
 *
 * The backend only BUILDS unsigned transactions; your wallet signs. This
 * script prints them and never sends. x402 stays discovery-only unless
 * X402_MODE=pay.
 */
import { deriveAssetSignerPda } from "@musebook/agent-kit";
import { spendGuardFromEnv, createX402Tools } from "@musebook/x402-metaplex";

const API = (process.env.CLAWD_API ?? "http://localhost:8787").replace(/\/+$/, "");
const WALLET = process.env.OWNER_WALLET ?? "<owner wallet (signs)>";
const AGENT = process.env.AGENT_ASSET ?? "<Metaplex Core agent asset>";

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);
  return j as Record<string, string>;
}

console.log("RWA program:", await fetch(`${API}/api/rwa/status`).then((r) => r.json()));
console.log("agent treasury (Asset Signer PDA):", deriveAssetSignerPda(AGENT).toBase58());

const reg = await post("/api/rwa/register/build", {
  wallet: WALLET, agentAsset: AGENT, assetType: "RealEstate", name: "Lot 7", symbol: "LOT7",
  description: "Tokenized parcel (devnet demo)", uri: "https://example.com/lot7.json", valuation: "1000000000",
});
console.log("1. sign + send register tx (unsigned):", reg.assetId, reg.tx.slice(0, 32) + "…");

const tok = await post("/api/rwa/tokenize/build", { wallet: WALLET, agentAsset: AGENT, assetId: reg.assetId, totalSupply: "1000000000" });
console.log("2. sign + send tokenize tx; RWA mint:", tok.mint);
console.log("3. trade it:", tok.next ?? "POST /api/amm/build");

const guard = spendGuardFromEnv();
const tools = createX402Tools({ fetch: globalThis.fetch, guard });
console.log("4. x402 (", guard.mode, ") pricing:", Object.keys((await tools[1].run({})) as object));
