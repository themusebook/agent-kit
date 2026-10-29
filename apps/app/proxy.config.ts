/**
 * Dev/preview proxy. Keeps every secret and keyed URL on the machine running Vite:
 *  - /server/* -> SERVER_URL (services/server). /server/internal/* gets the
 *    WORKER_SHARED_SECRET bearer added here, so the browser never sees it.
 *  - /rpc      -> SOLANA_RPC_URL (DAS-capable RPC; may contain an API key).
 * In production put the same two rules in your reverse proxy.
 */
export const DEFAULTS = {
  SERVER_URL: "http://localhost:4000",
  SOLANA_RPC_URL: "https://api.devnet.solana.com",
} as const;

type ProxyEnv = Record<string, string | undefined>;

export function serverProxy(env: ProxyEnv) {
  const target = (env.SERVER_URL?.trim() || DEFAULTS.SERVER_URL).replace(/\/+$/, "");
  const rpc = env.SOLANA_RPC_URL?.trim() || DEFAULTS.SOLANA_RPC_URL;
  const secret = env.WORKER_SHARED_SECRET?.trim();
  return {
    "/server": {
      target,
      changeOrigin: true,
      rewrite: (p: string) => p.replace(/^\/server/, ""),
      headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
    },
    "/rpc": {
      target: rpc,
      changeOrigin: true,
      rewrite: () => new URL(rpc).pathname + new URL(rpc).search,
    },
  };
}
