import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "test/**/*.test.ts"],
    // @metaplex-foundation/x402@0.1.0 ships ESM with extensionless relative
    // imports, which plain Node ESM cannot resolve; let Vite transform it.
    server: { deps: { inline: [/@metaplex-foundation\/x402/] } },
  },
});
