import path from "node:path";
import { defineConfig } from "vitest/config";
const pkg = (name: string) => path.resolve(__dirname, "../../packages", name, "src/index.ts");
export default defineConfig({
  resolve: {
    alias: {
      "@musebook/identity": pkg("identity"),
      "@musebook/discovery": pkg("discovery"),
      "@musebook/payments": pkg("payments"),
      "@musebook/wallet": pkg("wallet"),
      "@musebook/auth": pkg("auth"),
      "@solana/web3.js": path.resolve(__dirname, "node_modules/@solana/web3.js"),
    },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
