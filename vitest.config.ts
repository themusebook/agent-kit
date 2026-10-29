import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests import sibling packages by their published @themusebook/* names,
// exactly like a consumer would; alias them to the workspace sources
// (the same map as tsconfig.base.json `paths`).
export default defineConfig({
  resolve: {
    alias: {
      "@musebook/a2a-network": src("./packages/a2a-network/src/index.mjs"),
      "@musebook/agent-kit": src("./packages/client/src/index.ts"),
      "@musebook/identity": src("./packages/identity/src/index.ts"),
      "@musebook/auth": src("./packages/auth/src/index.ts"),
      "@musebook/discovery": src("./packages/discovery/src/index.ts"),
      "@musebook/payments": src("./packages/payments/src/index.ts"),
      "@musebook/wallet": src("./packages/wallet/src/index.ts"),
      "@musebook/finance": src("./packages/finance/src/index.ts"),
      "@musebook/templates": src("./packages/templates/src/index.ts"),
      "@musebook/stonk": src("./packages/stonk/src/index.ts"),
      "@musebook/perps": src("./packages/perps/src/index.ts"),
      "@musebook/a2a": src("./packages/a2a/src/index.ts"),
      "@musebook/x402-metaplex": src("./packages/x402-metaplex/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // @metaplex-foundation/x402@0.1.0 ships ESM with extensionless relative
    // imports, which plain Node ESM cannot resolve; let Vite transform it.
    server: { deps: { inline: [/@metaplex-foundation\/x402/] } },
  },
});
