// Single source of truth for what we publish and in which order (dependencies first).
export const PUBLISHABLE = [
  { dir: "packages/wallet", name: "@musebook/wallet" },
  { dir: "packages/identity", name: "@musebook/identity" },
  { dir: "packages/auth", name: "@musebook/auth" },
  { dir: "packages/discovery", name: "@musebook/discovery" },
  { dir: "packages/payments", name: "@musebook/payments" },
  { dir: "packages/x402-metaplex", name: "@musebook/x402-metaplex", vendor: "vendor-metaplex-x402.mjs" },
  { dir: "packages/stonk", name: "@musebook/stonk" },
  { dir: "packages/perps", name: "@musebook/perps" },
  { dir: "packages/finance", name: "@musebook/finance" },
  { dir: "packages/templates", name: "@musebook/templates" },
  { dir: "packages/a2a", name: "@musebook/a2a" },
  { dir: "packages/a2a-network", name: "@musebook/a2a-network", raw: true, publish: false },
  { dir: "packages/client", name: "@musebook/agent-kit" },
  { dir: "packages/cli", name: "@musebook/cli", bin: true, files: ["bin", "src", "templates", "README.md", "LICENSE"] },
  { dir: "agents/trading", name: "@musebook/trading-agents", subpaths: ["decision", "perps", "pumpfun-founder", "stonk"] },
];
