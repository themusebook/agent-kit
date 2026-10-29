import { describe, expect, it } from "vitest";
import { createApi, inboxStatus, summarizeX402m } from "../src/api";

describe("api", () => {
  it("reads routines from the dashboard proxy", async () => {
    const seen: string[] = [];
    const api = createApi("https://a.io/server", (async (url: string) => {
      seen.push(url);
      return new Response(JSON.stringify({ routines: [{ id: "1", agentId: "a", kind: "x402m.inbox-poll", intervalSeconds: 60, nextRunAt: 0 }] }));
    }) as unknown as typeof fetch);
    const routines = await api.routines();
    expect(seen).toEqual(["https://a.io/server/internal/routines"]);
    expect(inboxStatus(routines)).toEqual([{ agentId: "a", lastStatus: "not run yet" }]);
  });
  it("surfaces HTTP errors", async () => {
    const api = createApi("https://a.io/server", (async () => new Response("no", { status: 401 })) as unknown as typeof fetch);
    await expect(api.health()).rejects.toThrow("/health: HTTP 401");
  });
  it("summarizes x402m discovery", () => {
    expect(summarizeX402m({ execute_endpoint: "https://x", capabilities: ["send", 3] })).toMatchObject({ endpoint: "https://x", capabilities: ["send"] });
  });
});
