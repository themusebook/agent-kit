import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Tests import sibling packages by their published @themusebook/* names,
// exactly like a consumer would; alias them to the workspace sources
// (the same map as tsconfig.base.json `paths`).
export default defineConfig({
  resolve: {
    alias: {
      "@themusebook/agent-kit": src("./packages/client/src/index.ts"),
      "@themusebook/agent-kit-identity": src("./packages/identity/src/index.ts"),
      "@themusebook/agent-kit-auth": src("./packages/auth/src/index.ts"),
      "@themusebook/agent-kit-discovery": src("./packages/discovery/src/index.ts"),
      "@themusebook/agent-kit-payments": src("./packages/payments/src/index.ts"),
      "@themusebook/agent-kit-wallet": src("./packages/wallet/src/index.ts"),
      "@themusebook/agent-kit-finance": src("./packages/finance/src/index.ts"),
      "@themusebook/agent-kit-templates": src("./packages/templates/src/index.ts"),
      "@themusebook/agent-kit-stonk": src("./packages/stonk/src/index.ts"),
      "@themusebook/agent-kit-perps": src("./packages/perps/src/index.ts"),
      "@themusebook/agent-kit-a2a": src("./packages/a2a/src/index.ts"),
      "@themusebook/agent-kit-x402-metaplex": src("./packages/x402-metaplex/src/index.ts"),
    },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // @metaplex-foundation/x402@0.1.0 ships ESM with extensionless relative
    // imports, which plain Node ESM cannot resolve; let Vite transform it.
    server: { deps: { inline: [/@metaplex-foundation\/x402/] } },
  },
});
