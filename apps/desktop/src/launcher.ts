export const STORAGE_KEY = "agent-kit.dashboardUrl";

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Accept https, or http only for loopback. Returns the origin+path without credentials, or an error. */
export function normalizeDashboardUrl(input: string): { url: string } | { error: string } {
  const raw = input.trim();
  if (!raw) return { error: "Enter the dashboard URL." };
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { error: "That is not a URL." };
  }
  if (u.username || u.password) return { error: "Do not put credentials in the URL." };
  if (u.protocol === "http:" && !LOCAL.has(u.hostname)) return { error: "Use https (http only for localhost)." };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { error: "Use an http(s) URL." };
  u.hash = "";
  return { url: u.toString() };
}

export interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function savedUrl(store: Store): string | null {
  const v = store.getItem(STORAGE_KEY);
  if (!v) return null;
  const r = normalizeDashboardUrl(v);
  return "url" in r ? r.url : null;
}
