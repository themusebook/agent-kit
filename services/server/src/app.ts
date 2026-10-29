import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import type { MusebookClient } from "@musebook/toolkit/musebook";
import type { ServerConfig } from "./config";
import { validateRoutine, type Routine, type RoutineStore } from "./routines";

export type Deps = {
  config: ServerConfig;
  store: RoutineStore;
  musebook: MusebookClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

function sameSecret(header: string | undefined, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The agent-kit server: a thin coordinator between musebook.trade (directory, x402m)
 * and an OpenBot server that actually runs agent turns.
 *
 * No route here signs, pays, or accepts a private key. Register, mint and deploy stay
 * in the CLI, which only builds unsigned transactions for the user's own wallet.
 */
export function createApp({ config, store, musebook, fetchImpl = fetch, now = Date.now }: Deps) {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      musebook: config.musebookOrigin,
      database: config.databaseUrl ? "postgres" : "memory",
      openbot: config.openbotServerUrl,
    }),
  );

  app.get("/api/agents", async (c) => c.json(await musebook.directory()));
  app.get("/api/x402m/discovery", async (c) => c.json(await musebook.x402mDiscovery()));

  app.use("/internal/*", async (c, next) => {
    if (!sameSecret(c.req.header("authorization"), config.workerSharedSecret)) {
      return c.json({ error: "Unauthorized." }, 401);
    }
    return next();
  });

  app.get("/internal/routines", async (c) => c.json({ routines: await store.list() }));
  app.post("/internal/routines", async (c) => {
    try {
      return c.json(await store.create(validateRoutine(await c.req.json().catch(() => null)), now()), 201);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  async function run(routine: Routine): Promise<string> {
    if (routine.kind === "directory.refresh") {
      await musebook.directory();
      return "ok";
    }
    // Inbox polls and turns are executed by the OpenBot server, which holds the agent's
    // messaging identity. This server only tells it what is due.
    const response = await fetchImpl(`${config.openbotServerUrl}/internal/routines/run`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        ...(config.openbotServerToken ? { authorization: `Bearer ${config.openbotServerToken}` } : {}),
      },
      body: JSON.stringify({ routineId: routine.id, agentId: routine.agentId, kind: routine.kind, musebook: config.musebookOrigin }),
    });
    return response.ok ? "ok" : `openbot HTTP ${response.status}`;
  }

  app.post("/internal/routines/sweep", async (c) => {
    const due = await store.claimDue(now());
    const results = [];
    for (const routine of due) {
      let status: string;
      try {
        status = await run(routine);
      } catch (error) {
        status = `failed: ${(error as Error).message}`.slice(0, 200);
      }
      await store.record(routine.id, status);
      results.push({ id: routine.id, kind: routine.kind, status });
    }
    return c.json({ ran: results.length, results });
  });

  app.onError((error, c) => c.json({ error: error.message.slice(0, 200) }, 502));
  return app;
}
