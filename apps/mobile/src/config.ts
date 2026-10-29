const LOCAL = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

/**
 * The app talks to a deployed agent-kit dashboard (apps/app behind its proxy,
 * e.g. the Helm chart's ingress). The proxy adds the server bearer and keyed
 * RPC, so the phone holds no secrets: just this URL.
 */
export function normalizeDashboardUrl(input: string): { origin: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Enter the dashboard URL." };
  let u: URL;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { return { error: "That is not a URL." }; }
  if (u.username || u.password) return { error: "Do not put credentials in the URL." };
  if (u.protocol === "http:" && !LOCAL.has(u.hostname)) return { error: "Use https (http only for localhost or the emulator host)." };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Use an http(s) URL." };
  return { origin: u.origin };
}

export const serverBase = (origin: string) => `${origin}/server`;
export const rpcUrl = (origin: string) => `${origin}/rpc`;
