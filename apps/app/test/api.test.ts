import { describe, expect, it } from "vitest";
import { createApi, filterAgents, inboxStatus, summarizeX402m } from "../src/api";

const fakeFetch = (routes: Record<string, unknown>, seen: string[] = []) =>
  (async (url: string) => {
    seen.push(url);
    const body = routes[url];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;

describe("api", () => {
  it("reads everything through the /server proxy", async () => {
    const seen: string[] = [];
    const api = createApi(fakeFetch({
      "/server/health": { status: "ok", database: "memory" },
      "/server/api/agents": { total_agents: 2, agents: [{ assetId: "A1", name: "musebot" }, { assetId: "B2", name: "other" }] },
      "/server/api/x402m/discovery": { endpoint: "https://musebook.trade/api/auth/capability/execute", contentProfiles: ["quote/v1"] },
      "/server/internal/routines": { routines: [] },
    }, seen));
    expect((await api.health()).status).toBe("ok");
    const dir = await api.directory();
    expect(dir.totalAgents).toBe(2);
    expect(dir.agents[0].assetId).toBe("A1");
    expect((await api.x402m()).contentProfiles[0]).toEqual({ id: "quote/v1", name: "quote", major: 1 });
    expect(await api.routines()).toEqual([]);
    expect(seen.every((u) => u.startsWith("/server/"))).toBe(true);
  });
  it("surfaces HTTP errors", async () => {
    await expect(createApi(fakeFetch({})).health()).rejects.toThrow("HTTP 404");
  });
  it("summarizes discovery defensively", () => {
    expect(summarizeX402m(null)).toMatchObject({ endpoint: null, capabilities: [], contentProfiles: [] });
    expect(summarizeX402m({ execute_endpoint: "e", capabilities: ["x402m.send", 3] }).capabilities).toEqual(["x402m.send"]);
  });
  it("filters agents and derives inbox status", () => {
    const snap = { generatedAt: null, totalAgents: 1, byNetwork: null, agents: [{ id: "1", name: "Musebot", assetId: "A", description: null, wallet: null } as any] };
    expect(filterAgents(snap, "muse")).toHaveLength(1);
    expect(filterAgents(snap, "zzz")).toHaveLength(0);
    expect(inboxStatus([
      { id: "r", agentId: "musebot", kind: "x402m.inbox-poll", intervalSeconds: 60, nextRunAt: 0 },
      { id: "s", agentId: "x", kind: "directory.refresh", intervalSeconds: 60, nextRunAt: 0, lastStatus: "ok" },
    ])).toEqual([{ agentId: "musebot", lastStatus: "not run yet", nextRunAt: 0 }]);
  });
});
