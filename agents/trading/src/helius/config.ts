/** Webhook body for POST /v0/webhooks. The kit only builds it; you create the webhook yourself. */
export type WebhookType = "enhanced" | "raw" | "discord" | "enhancedDevnet" | "rawDevnet" | "discordDevnet";
export function webhookConfig(o: { webhookURL: string; accountAddresses: string[]; webhookType?: WebhookType; transactionTypes?: string[]; authHeader?: string; txnStatus?: "all" | "success" | "failed" }) {
  if (!/^https:\/\//.test(o.webhookURL)) throw new Error("webhookURL must be https");
  if (!o.accountAddresses.length || o.accountAddresses.length > 100_000) throw new Error("accountAddresses must have 1..100000 entries");
  return { webhookURL: o.webhookURL, webhookType: o.webhookType ?? "enhanced", accountAddresses: o.accountAddresses, transactionTypes: o.transactionTypes ?? ["ANY"], txnStatus: o.txnStatus ?? "all", ...(o.authHeader ? { authHeader: o.authHeader } : {}) };
}

/** helius-laserstream subscribe() arguments. apiKey is read from env by the server that runs it. */
export function laserstreamConfig(o: { accountInclude: string[]; endpoint?: string; env?: Record<string, string | undefined> }) {
  const env = o.env ?? process.env;
  return {
    config: { apiKey: env.HELIUS_API_KEY ? "<from HELIUS_API_KEY>" : "<set HELIUS_API_KEY>", endpoint: o.endpoint ?? "https://laserstream-mainnet-ewr.helius-rpc.com" },
    request: { transactions: { client: { accountInclude: o.accountInclude, accountExclude: [], accountRequired: [], vote: false, failed: false } }, commitment: "CONFIRMED", accounts: {}, slots: {}, transactionsStatus: {}, blocks: {}, blocksMeta: {}, entry: {}, accountsDataSlice: [] },
  };
}

/** Optional Helius MCP (stdio). Only these read actions are allowed through the kit. */
export const HELIUS_MCP = { command: "npx", args: ["helius-mcp@latest"], env: { HELIUS_API_KEY: "${HELIUS_API_KEY}" } } as const;
export const HELIUS_MCP_READ_ACTIONS: Record<string, string[] | "*"> = {
  heliusWallet: "*", heliusAsset: "*", heliusTransaction: "*", heliusKnowledge: "*", heliusCompression: "*",
  heliusChain: "*",
  heliusStreaming: ["getAllWebhooks", "getWebhookByID", "transactionSubscribe", "accountSubscribe", "laserstreamSubscribe"],
  heliusAccount: ["getStarted", "getAccountStatus", "getAccountPlan", "getHeliusPlanInfo"],
};
export const HELIUS_MCP_BLOCKED = ["heliusWrite", "generateKeypair", "signup", "upgradePlan", "payRenewal", "purchaseCredits", "setHeliusApiKey", "createWebhook", "updateWebhook", "deleteWebhook", "transferSol", "transferToken", "stakeSOL", "unstakeSOL", "withdrawStake"];

export function mcpCallAllowed(tool: string, action?: string): boolean {
  if (HELIUS_MCP_BLOCKED.includes(tool) || (action && HELIUS_MCP_BLOCKED.includes(action))) return false;
  const a = HELIUS_MCP_READ_ACTIONS[tool];
  if (!a) return false;
  return a === "*" || (!!action && a.includes(action));
}

/** Things only you can do. The kit never automates them. */
export const HELIUS_MANUAL_STEPS = [
  "Create a Helius account and API key yourself at https://dashboard.helius.dev (signup needs your email and name; paid plans are paid by you).",
  "Put the key in your server's environment as HELIUS_API_KEY. Never in client code, never committed.",
  "The kit does not run Helius agent signup, keygen, plan upgrades, renewals or credit purchases.",
];
