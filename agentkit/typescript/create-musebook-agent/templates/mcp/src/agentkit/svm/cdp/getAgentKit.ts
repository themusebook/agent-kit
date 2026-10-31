import {
  AgentKit,
  cdpApiActionProvider,
  CdpSolanaWalletProvider,
  jupiterActionProvider,
  splActionProvider,
  walletActionProvider,
} from "@musebook/agent-kit-core";

/**
 * Get the AgentKit instance.
 *
 * @returns {Promise<AgentKit>} The AgentKit instance
 */
export async function getAgentKit(): Promise<AgentKit> {
  try {
    // Initialize WalletProvider: https://github.com/themusebook/agent-kit/tree/main/agentkit
    const walletProvider = await CdpSolanaWalletProvider.configureWithWallet({
      apiKeyId: process.env.CDP_API_KEY_ID,
      apiKeySecret: process.env.CDP_API_KEY_SECRET,
      walletSecret: process.env.CDP_WALLET_SECRET,
      networkId: process.env.NETWORK_ID || "solana-devnet",
      address: process.env.ADDRESS,
      rpcUrl: process.env.RPC_URL,
      idempotencyKey: process.env.IDEMPOTENCY_KEY,
    });

    // Initialize AgentKit: https://github.com/themusebook/agent-kit/tree/main/agentkit
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        walletActionProvider(),
        splActionProvider(),
        jupiterActionProvider(),
        cdpApiActionProvider(),
      ],
    });

    return agentkit;
  } catch (error) {
    console.error("Error initializing agent:", error);
    throw new Error("Failed to initialize agent");
  }
}
