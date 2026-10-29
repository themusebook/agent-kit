import { defineConfig } from "vite";
export default defineConfig({
  server: { port: 3021, strictPort: true },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
