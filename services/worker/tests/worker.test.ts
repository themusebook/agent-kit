import { describe, expect, test } from "bun:test";
import { loadWorkerEnv, sweepUrl } from "../src/env";
import { runOneTick } from "../src/tick";

describe("worker env", () => {
  test("defaults", () => {
    expect(loadWorkerEnv({ WORKER_SHARED_SECRET: "s" })).toEqual({ workerSharedSecret: "s", serverInternalUrl: "http://localhost:4000", tickMs: 30000 });
  });
  test.each(["", "   ", undefined])("refuses secret %p", (v) => {
    expect(() => loadWorkerEnv({ WORKER_SHARED_SECRET: v })).toThrow("not set");
  });
  test("strips trailing slashes and refuses non-http", () => {
    expect(sweepUrl(loadWorkerEnv({ WORKER_SHARED_SECRET: "s", SERVER_INTERNAL_URL: "http://server:4000///" }).serverInternalUrl)).toBe("http://server:4000/internal/routines/sweep");
    expect(() => loadWorkerEnv({ WORKER_SHARED_SECRET: "s", SERVER_INTERNAL_URL: "ftp://x" })).toThrow("http");
    expect(() => loadWorkerEnv({ WORKER_SHARED_SECRET: "s", WORKER_TICK_MS: "10" })).toThrow("WORKER_TICK_MS");
  });
});

describe("tick", () => {
  const env = { workerSharedSecret: "s", serverInternalUrl: "http://server:4000", tickMs: 30000 };
  test("sends the secret and reports runs", async () => {
    let auth = "";
    const fake = (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).authorization;
      return new Response(JSON.stringify({ ran: 2 }));
    }) as unknown as typeof fetch;
    expect(await runOneTick(env, fake)).toEqual({ ok: true, detail: "ran 2" });
    expect(auth).toBe("Bearer s");
  });
  test("survives errors", async () => {
    const boom = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect(await runOneTick(env, boom)).toEqual({ ok: false, detail: "ECONNREFUSED" });
    const bad = (async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    expect((await runOneTick(env, bad)).detail).toBe("server answered 401");
  });
});
