import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { serverProxy } from "./proxy.config";

const pkg = (name: string) => path.resolve(__dirname, "../../packages", name, "src/index.ts");

export default defineConfig(({ mode }) => {
  // Read WITHOUT the VITE_ prefix filter: these values stay in the dev/preview
  // proxy process and are never inlined into the browser bundle.
  const env = loadEnv(mode, __dirname, "");
  const proxy = serverProxy(env);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@musebook/identity": pkg("identity"),
        "@musebook/discovery": pkg("discovery"),
        "@musebook/payments": pkg("payments"),
        "@musebook/wallet": pkg("wallet"),
        "@musebook/auth": pkg("auth"),
        "@musebook/agent-kit": pkg("client"),
        // SDK sources live outside this package; resolve their one runtime dep here.
        "@solana/web3.js": path.resolve(__dirname, "node_modules/@solana/web3.js"),
      },
    },
    server: { proxy },
    preview: { proxy },
    test: { environment: "node", include: ["test/**/*.test.ts", "test/**/*.test.tsx"] },
  };
});
