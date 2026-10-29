import { describe, expect, it, vi } from "vitest";
import {
  A2A_MAX_BODY_BYTES,
  connectA2A,
  createA2AClient,
  validateHandle,
  type A2ATokenStore,
} from "../src/index";
import {
  A2AAuthError,
  A2AHandleTakenError,
  A2AValidationError,
  isA2AAuthError,
} from "../src/errors";
import { InMemoryA2ATokenStore } from "../src/tokenStore";

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  return vi.fn(async (input: unknown, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as typeof fetch;
}

/** Real presence shape, trimmed from the live 2026-10-29 response. */
const AGENTS_BODY = {
  ok: true,
  count: 2,
  agents: [
    {
      handle: "clawd",
      display_name: "Clawd 🦞 (Muse side)",
      model: "muse-spark",
      capabilities: ["solana", "trading", "research", "code"],
      last_seen: "2026-10-01T17:45:55.131Z",
      created_at: "2026-09-30T17:01:07.720Z",
    },
    {
      handle: "probe-9428",
      display_name: "probe-9428",
      model: null,
      capabilities: [],
      last_seen: "2026-10-27T01:50:11.178Z",
      created_at: "2026-10-27T01:48:22.371Z",
    },
  ],
};

describe("discovery / health / presence parsing", () => {
  it("parses the agents list against the real response shape (model may be null)", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url).toBe("https://musebook.trade/a2a/agents");
      return jsonResponse(AGENTS_BODY);
    });
    const client = createA2AClient({ fetchImpl });
    const res = await client.agents();
    expect(res.ok).toBe(true);
    expect(res.count).toBe(2);
    expect(res.agents[0]).toMatchObject({ handle: "clawd", model: "muse-spark" });
    expect(res.agents[1]!.model).toBeNull();
    expect(res.agents[0]!.capabilities).toContain("solana");
  });

  it("parses health and the discovery card", async () => {
    const fetchImpl = mockFetch((url) => {
      if (url.endsWith("/a2a/health")) {
        return jsonResponse({ ok: true, service: "clawd-a2a", version: "0.1.0", now: "2026-10-29T20:16:46.262Z" });
      }
      return jsonResponse({
        name: "Clawd A2A Relay",
        description: "relay",
        url: "https://musebook.trade",
        version: "0.1.0",
        protocol: "clawd-a2a/0.1",
        endpoints: {
          register: "POST https://musebook.trade/a2a/register",
          send: "POST https://musebook.trade/a2a/send",
          inbox: "GET https://musebook.trade/a2a/inbox",
          ack: "POST https://musebook.trade/a2a/ack",
          agents: "GET https://musebook.trade/a2a/agents",
          health: "GET https://musebook.trade/a2a/health",
        },
        authentication: { schemes: ["bearer"] },
        capabilities: ["message-relay", "threads", "presence", "broadcast", "pending-delivery", "long-poll"],
        message_types: ["task", "message", "result"],
      });
    });
    const client = createA2AClient({ fetchImpl });
    const health = await client.health();
    expect(health).toMatchObject({ ok: true, service: "clawd-a2a", version: "0.1.0" });
    const card = await client.discovery();
    expect(card.protocol).toBe("clawd-a2a/0.1");
    expect(card.message_types).toEqual(["task", "message", "result"]);
  });

  it("honours a baseUrl override", async () => {
    const fetchImpl = mockFetch((url) => {
      expect(url.startsWith("https://relay.example/")).toBe(true);
      return jsonResponse({ ok: true, service: "clawd-a2a", version: "0.1.0" });
    });
    const client = createA2AClient({ baseUrl: "https://relay.example/", fetchImpl });
    await client.health();
  });
});

describe("register + token store", () => {
  it("posts the documented shape, returns agent_id/handle/token, and stores the token without logging it", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = new InMemoryA2ATokenStore();
    const fetchImpl = mockFetch((url, init) => {
      expect(url).toBe("https://musebook.trade/a2a/register");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({
        handle: "my-agent",
        display_name: "My Agent",
        model: "my-model",
        capabilities: ["research"],
      });
      return jsonResponse(
        { agent_id: "uuid-1", handle: "my-agent", token: "secret-token-value" },
        { status: 201 },
      );
    });
    const client = createA2AClient({ fetchImpl, tokenStore: store });
    const reg = await client.register({
      handle: "my-agent",
      display_name: "My Agent",
      model: "my-model",
      capabilities: ["research"],
    });
    expect(reg).toEqual({ agent_id: "uuid-1", handle: "my-agent", token: "secret-token-value" });
    expect(await store.get()).toBe("secret-token-value");
    // Token discipline by design: nothing in this package logs, and the
    // token only ever travels in the Authorization header / result.
    for (const spy of [logSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain("secret-token-value");
      }
    }
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("maps 409 handle_taken onto A2AHandleTakenError", async () => {
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { ok: false, error: "handle_taken", message: "That handle is already registered." },
        { status: 409 },
      ),
    );
    const client = createA2AClient({ fetchImpl });
    const err = await client
      .register({ handle: "clawd", display_name: "x", model: "y" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(A2AHandleTakenError);
    expect((err as A2AHandleTakenError).handle).toBe("clawd");
    expect((err as A2AHandleTakenError).status).toBe(409);
    expect((err as A2AHandleTakenError).code).toBe("handle_taken");
  });

  it("validates handle shape client-side (live relay rule)", () => {
    expect(validateHandle("my-agent-1")).toBe("my-agent-1");
    expect(validateHandle("12345")).toBe("12345");
    expect(() => validateHandle("Bad Handle!")).toThrow(A2AValidationError);
    expect(() => validateHandle("ab")).toThrow(/3-32 chars/);
    expect(() => validateHandle("-leading-dash")).toThrow(A2AValidationError);
    expect(() => validateHandle("a".repeat(33))).toThrow(A2AValidationError);
  });
});

describe("send validation + flow", () => {
  async function authedClient(handler: (url: string, init?: RequestInit) => Response) {
    const store = new InMemoryA2ATokenStore();
    await store.set("tok-abc");
    return createA2AClient({ fetchImpl: mockFetch(handler), tokenStore: store });
  }

  it("sends with the Bearer header and maps the result", async () => {
    const client = await authedClient((url, init) => {
      expect(url).toBe("https://musebook.trade/a2a/send");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok-abc");
      expect(JSON.parse(String(init?.body))).toEqual({
        to: "other-agent",
        type: "task",
        body: { do: "summarize this" },
        thread_id: "t-1",
      });
      return jsonResponse({ ok: true, message_id: "m-1", delivered_to: "other-agent", thread_id: "t-1" });
    });
    const res = await client.send({
      to: "other-agent",
      type: "task",
      body: { do: "summarize this" },
      thread_id: "t-1",
    });
    expect(res).toEqual({ ok: true, message_id: "m-1", delivered_to: "other-agent", thread_id: "t-1" });
  });

  it("accepts broadcast as a recipient without handle validation", async () => {
    const client = await authedClient(() =>
      jsonResponse({ ok: true, message_id: "m-2", delivered_to: "broadcast" }),
    );
    const res = await client.send({ to: "broadcast", type: "message", body: { hi: true } });
    expect(res.delivered_to).toBe("broadcast");
  });

  it("rejects an oversized body before any fetch", async () => {
    let fetched = false;
    const client = await authedClient(() => {
      fetched = true;
      return jsonResponse({});
    });
    const big = { blob: "x".repeat(A2A_MAX_BODY_BYTES) };
    await expect(client.send({ to: "clawd", type: "task", body: big })).rejects.toBeInstanceOf(
      A2AValidationError,
    );
    expect(fetched).toBe(false);
  });

  it("rejects ttl out of range and unknown types", async () => {
    const client = await authedClient(() => jsonResponse({}));
    await expect(
      client.send({ to: "clawd", type: "task", body: {}, ttl_s: 59 }),
    ).rejects.toMatchObject({ name: "A2AValidationError", field: "ttl_s" });
    await expect(
      client.send({ to: "clawd", type: "task", body: {}, ttl_s: 604801 }),
    ).rejects.toMatchObject({ field: "ttl_s" });
    await expect(
      client.send({ to: "clawd", type: "chore" as never, body: {} }),
    ).rejects.toMatchObject({ field: "type" });
    // Boundary values pass validation (fetch then answers).
    const okClient = await authedClient(() =>
      jsonResponse({ ok: true, message_id: "m", delivered_to: "clawd" }),
    );
    await expect(
      okClient.send({ to: "clawd", type: "result", body: {}, ttl_s: 60 }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      okClient.send({ to: "clawd", type: "result", body: {}, ttl_s: 604800 }),
    ).resolves.toMatchObject({ ok: true });
  });
});

describe("inbox / ack flows + auth mapping", () => {
  it("parses inbox messages and acks them", async () => {
    const store = new InMemoryA2ATokenStore();
    await store.set("tok-abc");
    const fetchImpl = mockFetch((url, init) => {
      if (url.startsWith("https://musebook.trade/a2a/inbox")) {
        expect(url).toContain("thread_id=smoke-thread");
        expect(url).toContain("wait_s=25");
        return jsonResponse({
          ok: true,
          messages: [
            {
              id: "m-1",
              from: "relay-smoke-20261029",
              to: "relay-smoke-20261029",
              type: "task",
              body: { do: "smoke ping" },
              thread_id: "smoke-thread",
            },
          ],
        });
      }
      expect(url).toBe("https://musebook.trade/a2a/ack");
      expect(JSON.parse(String(init?.body))).toEqual({ message_ids: ["m-1"] });
      return jsonResponse({ ok: true, acked: 1 });
    });
    const client = createA2AClient({ fetchImpl, tokenStore: store });
    const inbox = await client.inbox({ thread_id: "smoke-thread", wait_s: 25 });
    expect(inbox.messages).toHaveLength(1);
    expect(inbox.messages[0]).toMatchObject({ id: "m-1", type: "task", from: "relay-smoke-20261029" });
    const ack = await client.ack(["m-1"]);
    expect(ack).toEqual({ ok: true, acked: 1 });
  });

  it("rejects wait_s above the 25s long-poll ceiling", async () => {
    const store = new InMemoryA2ATokenStore();
    await store.set("tok-abc");
    const client = createA2AClient({ fetchImpl: mockFetch(() => jsonResponse({})), tokenStore: store });
    await expect(client.inbox({ wait_s: 26 })).rejects.toMatchObject({ field: "wait_s" });
  });

  it("maps a relay 401 onto A2AAuthError", async () => {
    const store = new InMemoryA2ATokenStore();
    await store.set("bad-token");
    const fetchImpl = mockFetch(() =>
      jsonResponse(
        { ok: false, error: "unauthorized", message: "Valid Bearer token required." },
        { status: 401 },
      ),
    );
    const client = createA2AClient({ fetchImpl, tokenStore: store });
    const err = await client.inbox().catch((e: unknown) => e);
    expect(isA2AAuthError(err)).toBe(true);
    expect((err as A2AAuthError).status).toBe(401);
  });

  it("throws A2AAuthError locally when no token is stored — before any fetch", async () => {
    let fetched = false;
    const client = createA2AClient({
      fetchImpl: mockFetch(() => {
        fetched = true;
        return jsonResponse({});
      }),
    });
    await expect(client.send({ to: "clawd", type: "task", body: {} })).rejects.toBeInstanceOf(
      A2AAuthError,
    );
    expect(fetched).toBe(false);
  });
});

describe("connectA2A register-or-reuse", () => {
  it("reuses a stored token without calling the relay", async () => {
    let fetched = false;
    const store = new InMemoryA2ATokenStore();
    await store.set("existing-token");
    const res = await connectA2A({
      handle: "my-agent",
      display_name: "My Agent",
      model: "my-model",
      tokenStore: store,
      fetchImpl: mockFetch(() => {
        fetched = true;
        return jsonResponse({});
      }),
    });
    expect(res.reused).toBe(true);
    expect(res.registration).toBeUndefined();
    expect(fetched).toBe(false);
  });

  it("registers when the store is empty and surfaces handle_taken typed", async () => {
    const okFetch = mockFetch(() =>
      jsonResponse({ agent_id: "u", handle: "fresh-agent", token: "t-1" }, { status: 201 }),
    );
    const res = await connectA2A({
      handle: "fresh-agent",
      display_name: "Fresh",
      model: "m",
      fetchImpl: okFetch,
    });
    expect(res.reused).toBe(false);
    expect(res.registration?.token).toBe("t-1");

    const takenFetch = mockFetch(() =>
      jsonResponse(
        { ok: false, error: "handle_taken", message: "That handle is already registered." },
        { status: 409 },
      ),
    );
    await expect(
      connectA2A({ handle: "clawd", display_name: "x", model: "y", fetchImpl: takenFetch }),
    ).rejects.toBeInstanceOf(A2AHandleTakenError);
  });

  it("accepts a caller-supplied custom token store", async () => {
    let saved: string | null = null;
    const custom: A2ATokenStore = {
      get: async () => saved,
      set: async (t) => {
        saved = t;
      },
      clear: async () => {
        saved = null;
      },
    };
    const fetchImpl = mockFetch(() =>
      jsonResponse({ agent_id: "u", handle: "custom-agent", token: "tok-custom" }, { status: 201 }),
    );
    await connectA2A({ handle: "custom-agent", display_name: "C", model: "m", tokenStore: custom, fetchImpl });
    expect(saved).toBe("tok-custom");
  });
});
