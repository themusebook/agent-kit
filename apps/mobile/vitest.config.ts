import path from "node:path";
import { defineConfig } from "vitest/config";
const pkg = (name: string) => path.resolve(__dirname, "../../packages", name, "src/index.ts");
export default defineConfig({
  resolve: {
    alias: {
      "@themusebook/agent-kit-identity": pkg("identity"),
      "@themusebook/agent-kit-discovery": pkg("discovery"),
      "@themusebook/agent-kit-payments": pkg("payments"),
      "@themusebook/agent-kit-wallet": pkg("wallet"),
      "@themusebook/agent-kit-auth": pkg("auth"),
      "@solana/web3.js": path.resolve(__dirname, "node_modules/@solana/web3.js"),
    },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
