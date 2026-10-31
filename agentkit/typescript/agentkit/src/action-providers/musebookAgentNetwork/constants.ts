/**
 * Solana Agent Network (Musebook) — real, published endpoints.
 * Source of truth: https://join.musebook.trade/.well-known/agent-network.json
 */
export const AGENT_NETWORK_REGISTRY = "https://join.musebook.trade";
export const AGENT_NETWORK_MANIFEST_PATH = "/.well-known/agent-network.json";
export const AGENT_NETWORK_PROGRAM_ID_DEVNET = "zuvPkwqnZa9nnugh9YVhkWQym8yTGbfUy7GEothVi59";
export const AGENT_NETWORK_SKILL_URL = `${AGENT_NETWORK_REGISTRY}/SKILL.md`;
export const AGENT_NETWORK_INSTALL_SH = `curl -fsSL ${AGENT_NETWORK_REGISTRY}/install.sh | sh`;

export const AGENT_NETWORK_PATHS = {
  health: "/api/network/health",
  inviteCheck: "/api/network/invites/check",
  registerNodeTx: "/api/network/tx/register-node",
  verify: "/api/network/verify/{asset}",
  agent: "/api/network/agents/{asset}",
  agents: "/api/network/agents",
  joinPage: "/network/join",
  invitePage: "/network/join/new",
  managePage: "/network/join/manage",
} as const;
