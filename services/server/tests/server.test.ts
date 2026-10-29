import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { loadConfig, DEFAULTS } from "../src/config";
import { createMemoryRoutineStore, validateRoutine } from "../src/routines";
import { createMusebookClient } from "@musebook/toolkit/musebook";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function setup(openbotStatus = 202) {
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes("/live/agents.json")) return json({ total_agents: 2, agents: [] });
    if (String(url).includes("/api/x402m/discovery")) return json({ protocol: "x402m" });
    return json({}, openbotStatus);
  }) as unknown as typeof fetch;
  const config = loadConfig({ WORKER_SHARED_SECRET: "s3" });
  let clock = 1_000_000;
  const app = createApp({
    config, store: createMemoryRoutineStore(),
    musebook: createMusebookClient(config.musebookOrigin, fake), fetchImpl: fake, now: () => clock,
  });
  return { app, calls, tick: (ms: number) => (clock += ms) };
}
const auth = { authorization: "Bearer s3", "content-type": "application/json" };

describe("config", () => {
  test("documented defaults", () => {
    const c = loadConfig({});
    expect(c.port).toBe(DEFAULTS.PORT);
    expect(c.openbotServerUrl).toBe("http://localhost:8000");
    expect(c.musebookOrigin).toBe("https://musebook.trade");
    expect(c.databaseUrl).toBeUndefined();
  });
  test("refuses bad values", () => {
    expect(() => loadConfig({ PORT: "30o0" })).toThrow("PORT");
    expect(() => loadConfig({ DATABASE_URL: "mysql://x" })).toThrow("postgres");
  });
});

describe("routines", () => {
  test("validation", () => {
    expect(() => validateRoutine({ agentId: "../x", kind: "x402m.inbox-poll", intervalSeconds: 60 })).toThrow();
    expect(() => validateRoutine({ agentId: "a", kind: "pay", intervalSeconds: 60 })).toThrow("kind");
    expect(() => validateRoutine({ agentId: "a", kind: "x402m.inbox-poll", intervalSeconds: 5 })).toThrow();
  });
});

describe("server", () => {
  test("health and musebook proxies", async () => {
    const { app } = setup();
    expect((await (await app.request("/health")).json()).database).toBe("memory");
    expect((await (await app.request("/api/agents")).json()).total_agents).toBe(2);
    expect((await (await app.request("/api/x402m/discovery")).json()).protocol).toBe("x402m");
  });
  test("internal routes need the worker secret", async () => {
    const { app } = setup();
    expect((await app.request("/internal/routines")).status).toBe(401);
    expect((await app.request("/internal/routines", { headers: { authorization: "Bearer nope" } })).status).toBe(401);
  });
  test("sweep runs due routines once per interval and forwards to OpenBot", async () => {
    const { app, calls, tick } = setup();
    const created = await app.request("/internal/routines", {
      method: "POST", headers: auth, body: JSON.stringify({ agentId: "musebot", kind: "x402m.inbox-poll", intervalSeconds: 60 }),
    });
    expect(created.status).toBe(201);
    const first = await (await app.request("/internal/routines/sweep", { method: "POST", headers: auth })).json();
    expect(first.results[0].status).toBe("ok");
    expect(calls).toContain("http://localhost:8000/internal/routines/run");
    expect((await (await app.request("/internal/routines/sweep", { method: "POST", headers: auth })).json()).ran).toBe(0);
    tick(60_000);
    expect((await (await app.request("/internal/routines/sweep", { method: "POST", headers: auth })).json()).ran).toBe(1);
  });
  test("an unreachable OpenBot is recorded, not thrown", async () => {
    const { app } = setup(503);
    await app.request("/internal/routines", { method: "POST", headers: auth, body: JSON.stringify({ agentId: "a", kind: "openbot.turn", intervalSeconds: 30 }) });
    const r = await (await app.request("/internal/routines/sweep", { method: "POST", headers: auth })).json();
    expect(r.results[0].status).toBe("openbot HTTP 503");
  });
});
