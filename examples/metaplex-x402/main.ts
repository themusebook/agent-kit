/**
 * Metaplex x402 agent.
 *
 *   X402_MODE unset  → discovery only: models, pricing, delegate status. Never pays.
 *   X402_MODE=pay    → also runs one chat call within X402_MAX_PER_REQUEST_USD / X402_SESSION_BUDGET_USD.
 *   X402_PAYER=standard|core|delegated-reactive|delegated-proactive (default standard)
 *   SVM_PRIVATE_KEY (env only), CORE_ASSET_ADDRESS (core/delegated), SVM_RPC_URL.
 */
import {
  spendGuardFromEnv, signerFromEnv, createStandardPayer, createCoreAssetPayer, createDelegatedPayer,
  createX402Tools, checkCapsAgainstPricing, delegateStatus,
} from "@themusebook/agent-kit-x402-metaplex";

const guard = spendGuardFromEnv();
const discovery = createX402Tools({ fetch: globalThis.fetch, guard });
const tool = (name: string) => discovery.find((t) => t.name === name)!;

const models = (await tool("x402_models").run({})) as { id: string }[];
console.log("models:", models.map((m) => m.id).join(", "));
console.log("caps vs pricing:", await checkCapsAgainstPricing(guard));
if (process.env.CORE_ASSET_ADDRESS) console.log("delegate:", await delegateStatus(process.env.CORE_ASSET_ADDRESS));

if (guard.mode === "pay") {
  const signer = await signerFromEnv();
  const rpcUrl = process.env.SVM_RPC_URL ?? "https://api.mainnet-beta.solana.com";
  const asset = process.env.CORE_ASSET_ADDRESS ?? "";
  const payer = process.env.X402_PAYER ?? "standard";
  const paying =
    payer === "core" ? createCoreAssetPayer(signer, { asset, rpcUrl, guard })
    : payer === "delegated-reactive" ? createDelegatedPayer(signer, { asset, rpcUrl, guard, strategy: "reactive" })
    : payer === "delegated-proactive" ? createDelegatedPayer(signer, { asset, rpcUrl, guard, strategy: "proactive" })
    : createStandardPayer(signer, { guard, rpcUrl });
  const tools = createX402Tools({ fetch: paying, guard });
  const chat = tools.find((t) => t.name === "x402_chat")!;
  console.log(await chat.run({ model: "openai/gpt-5.4-mini", messages: [{ role: "user", content: "Say hi in one word." }], max_tokens: 8 }));
  console.log("budget:", await tools.find((t) => t.name === "x402_budget")!.run({}));
}
