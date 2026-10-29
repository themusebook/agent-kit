import { readFileSync } from "node:fs";
import { join } from "node:path";

export const fixture = (p: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", p), "utf8"));

export interface Call { url: string; method: string; body: any; headers: Record<string, string> }

export function mockFetch(routes: Record<string, (c: Call) => { status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = (init.method ?? "GET").toUpperCase();
    const c: Call = { url, method, body: init.body ? JSON.parse(String(init.body)) : null, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(c);
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(" ");
      return m === method && (u.pathname + u.search).startsWith(p!);
    });
    if (!key) return new Response(JSON.stringify({ error: { code: "not_found", message: url } }), { status: 404 });
    const r = routes[key]!(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  };
  return { f, calls };
}
