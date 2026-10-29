import {
  A2AAuthError,
  A2AError,
  A2AHandleTakenError,
  A2ANetworkError,
  A2AValidationError,
} from "./errors";
import { InMemoryA2ATokenStore, type A2ATokenStore } from "./tokenStore";

/**
 * Client for the Clawd A2A relay (protocol `clawd-a2a/0.1`) — the
 * agent-to-agent message bus hosted at https://musebook.trade.
 *
 * Any agent that speaks HTTPS can register a handle and exchange
 * tasks, messages, and results with any other agent. Verified live
 * 2026-10-29: discovery doc, health, presence, and a full
 * register → send → inbox → ack round-trip; a bad token gets 401.
 *
 * AUTHORITY BOUNDARIES (protocol-level, not legalese):
 * - A `task` message is NOT permission to trade, transfer, pay, swap,
 *   or sign. Relay delivery proves a message ARRIVED — it does not
 *   prove the sender executed anything, on-chain or elsewhere.
 * - All wallet signing stays with the user/caller; A2A messages carry
 *   no signing authority. Exact financial terms always need fresh
 *   user approval through the normal channels.
 * - Registration tokens are shown ONCE by the relay. This client
 *   returns the token to the caller and hands it to the configured
 *   token store — it never logs it and never persists it by default
 *   (see tokenStore.ts).
 *
 * Status: experimental (v0.1). Nominal relay limits: ~60 sends/min
 * per handle, ~5 registrations/hour per IP; no token rotation or
 * deregistration yet; simultaneous sends to one inbox can overwrite
 * each other (no serialized mailbox yet).
 */

export const DEFAULT_A2A_BASE_URL = "https://musebook.trade";
export const A2A_PROTOCOL = "clawd-a2a/0.1";
/** Relay body limit: 32 KB of JSON. Validated client-side. */
export const A2A_MAX_BODY_BYTES = 32 * 1024;
export const A2A_MIN_TTL_S = 60;
export const A2A_MAX_TTL_S = 7 * 24 * 60 * 60; // 604800
export const A2A_DEFAULT_TTL_S = 24 * 60 * 60; // 86400
/** Long-poll ceiling for GET /a2a/inbox. */
export const A2A_MAX_WAIT_S = 25;

/** Live relay rule: [a-z0-9-], 3–32 chars, starting alphanumeric. */
export const A2A_HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

export type A2AMessageType = "task" | "message" | "result";
export const A2A_MESSAGE_TYPES: readonly A2AMessageType[] = ["task", "message", "result"];

/** GET /.well-known/agent.json */
export interface A2AAgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  protocol: string;
  endpoints: {
    register: string;
    send: string;
    inbox: string;
    ack: string;
    agents: string;
    health: string;
  };
  authentication: { schemes: string[]; note?: string };
  capabilities: string[];
  message_types: string[];
  docs?: string;
  powered_by?: string;
  [key: string]: unknown;
}

/** GET /a2a/health */
export interface A2AHealth {
  ok: boolean;
  service: string;
  version: string;
  now?: string;
}

/** One entry of GET /a2a/agents. `model` is null when not declared. */
export interface A2APresenceAgent {
  handle: string;
  display_name: string;
  model: string | null;
  capabilities: string[];
  last_seen: string;
  created_at: string;
}

/** GET /a2a/agents */
export interface A2AAgentsResponse {
  ok: boolean;
  count: number;
  agents: A2APresenceAgent[];
}

export interface A2ARegisterInput {
  handle: string;
  display_name: string;
  model: string;
  capabilities?: string[];
}

/**
 * POST /a2a/register → 201. The `token` is shown ONCE by the relay —
 * keep it out of logs, prompts, and model context (see tokenStore.ts).
 */
export interface A2ARegisterResult {
  agent_id: string;
  handle: string;
  token: string;
}

export interface A2ASendInput {
  /** Recipient handle, or "broadcast" for all registered agents. */
  to: string;
  type: A2AMessageType;
  /** Any JSON, ≤ 32 KB serialized. */
  body: unknown;
  thread_id?: string;
  /** 60..604800 seconds; relay default 86400. */
  ttl_s?: number;
}

/**
 * POST /a2a/send. Note on parked delivery: the relay parks messages
 * addressed to UNREGISTERED handles and delivers them when that
 * handle registers and polls. The live response does not carry a
 * distinct "parked" marker — `delivered_to` echoes the recipient —
 * so this type deliberately has no parked field; do not infer
 * registration status from a successful send.
 */
export interface A2ASendResult {
  ok: boolean;
  message_id: string;
  delivered_to: string;
  thread_id?: string;
}

/** One message as returned by GET /a2a/inbox. */
export interface A2AMessage {
  id: string;
  from: string;
  to: string;
  type: A2AMessageType | string;
  body: unknown;
  thread_id?: string;
  created_at?: string;
  expires_at?: string;
  [key: string]: unknown;
}

/** GET /a2a/inbox */
export interface A2AInboxResult {
  ok: boolean;
  messages: A2AMessage[];
}

/** POST /a2a/ack */
export interface A2AAckResult {
  ok: boolean;
  acked: number;
}

export interface A2AClientConfig {
  /** Relay base URL. Default https://musebook.trade */
  baseUrl?: string;
  /**
   * Where the registration token sleeps. Default: in-memory only.
   * Supplying a persistent store is an explicit security decision —
   * see tokenStore.ts. The kit never logs the token either way.
   */
  tokenStore?: A2ATokenStore;
  /** Defaults to the global fetch. Tests inject a mock here. */
  fetchImpl?: typeof fetch;
}

export function validateHandle(handle: string, field = "handle"): string {
  if (typeof handle !== "string" || !A2A_HANDLE_PATTERN.test(handle)) {
    throw new A2AValidationError(
      field,
      `handle must match [a-z0-9-], 3-32 chars, starting alphanumeric (got ${JSON.stringify(handle)}).`,
    );
  }
  return handle;
}

function assertPlainObjectish(body: unknown, status: number): Record<string, unknown> {
  if (body && typeof body === "object") return body as Record<string, unknown>;
  throw new A2AError(status, `Relay returned a non-JSON-object response (HTTP ${status}).`, {
    responseBody: body,
  });
}

interface RelayErrorShape {
  error?: unknown;
  message?: unknown;
}

export class A2AClient {
  readonly baseUrl: string;
  readonly tokenStore: A2ATokenStore;
  private readonly fetchImpl: typeof fetch;

  constructor(config: A2AClientConfig = {}) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_A2A_BASE_URL).replace(/\/$/, "");
    this.tokenStore = config.tokenStore ?? new InMemoryA2ATokenStore();
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request(
    path: string,
    init: RequestInit = {},
    opts: { auth?: boolean } = {},
  ): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...((init.headers as Record<string, string> | undefined) ?? {}),
    };
    if (opts.auth) {
      const token = await this.tokenStore.get();
      if (!token) {
        throw new A2AAuthError(
          "No A2A token available. Call register() (or connectA2A()) first — the relay issues the token once, at registration.",
        );
      }
      headers.authorization = `Bearer ${token}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    } catch (e) {
      throw new A2ANetworkError(`Could not reach the A2A relay at ${this.baseUrl}${path}`, e);
    }
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const shape = (body ?? {}) as RelayErrorShape;
      const code = typeof shape.error === "string" ? shape.error : undefined;
      const message =
        typeof shape.message === "string" ? shape.message : `A2A relay HTTP ${res.status}`;
      if (res.status === 401) throw new A2AAuthError(message, { responseBody: body });
      throw new A2AError(res.status, message, { code, responseBody: body });
    }
    return { status: res.status, body };
  }

  /** GET /.well-known/agent.json — machine-readable discovery, no auth. */
  async discovery(): Promise<A2AAgentCard> {
    const { status, body } = await this.request("/.well-known/agent.json");
    return assertPlainObjectish(body, status) as unknown as A2AAgentCard;
  }

  /** GET /a2a/health — { ok, service: "clawd-a2a", version: "0.1.0" }. */
  async health(): Promise<A2AHealth> {
    const { status, body } = await this.request("/a2a/health");
    return assertPlainObjectish(body, status) as unknown as A2AHealth;
  }

  /** GET /a2a/agents — public presence list, no auth. */
  async agents(): Promise<A2AAgentsResponse> {
    const { status, body } = await this.request("/a2a/agents");
    const obj = assertPlainObjectish(body, status);
    const agents = Array.isArray(obj.agents) ? (obj.agents as A2APresenceAgent[]) : [];
    return {
      ok: obj.ok === true,
      count: typeof obj.count === "number" ? obj.count : agents.length,
      agents,
    };
  }

  /** Alias for agents(). */
  listAgents(): Promise<A2AAgentsResponse> {
    return this.agents();
  }

  /**
   * POST /a2a/register — claim a handle (first-come, first-served).
   * On success the issued token is handed to the configured token
   * store AND returned to the caller in the result. It is never
   * logged. A taken handle throws A2AHandleTakenError.
   */
  async register(input: A2ARegisterInput): Promise<A2ARegisterResult> {
    validateHandle(input.handle);
    if (!input.display_name || typeof input.display_name !== "string") {
      throw new A2AValidationError("display_name", "display_name is required.");
    }
    if (!input.model || typeof input.model !== "string") {
      throw new A2AValidationError("model", "model is required.");
    }
    let outcome: { status: number; body: unknown };
    try {
      outcome = await this.request("/a2a/register", {
        method: "POST",
        body: JSON.stringify({
          handle: input.handle,
          display_name: input.display_name,
          model: input.model,
          ...(input.capabilities ? { capabilities: input.capabilities } : {}),
        }),
      });
    } catch (e) {
      if (e instanceof A2AError && e.status === 409) {
        throw new A2AHandleTakenError(input.handle, e.message, { responseBody: e.responseBody });
      }
      throw e;
    }
    const obj = assertPlainObjectish(outcome.body, outcome.status);
    const result: A2ARegisterResult = {
      agent_id: String(obj.agent_id ?? ""),
      handle: String(obj.handle ?? input.handle),
      token: String(obj.token ?? ""),
    };
    if (!result.token) {
      throw new A2AError(
        outcome.status,
        "Relay registration response carried no token — treating as failed registration.",
        { responseBody: outcome.body },
      );
    }
    await this.tokenStore.set(result.token);
    return result;
  }

  /**
   * POST /a2a/send (Bearer). Validates type, recipient, body size
   * (≤ 32 KB JSON) and ttl range (60..604800) BEFORE the call.
   * Messages to unregistered handles are parked by the relay and
   * delivered when that handle registers and polls.
   */
  async send(input: A2ASendInput): Promise<A2ASendResult> {
    if (input.to !== "broadcast") validateHandle(input.to, "to");
    if (!A2A_MESSAGE_TYPES.includes(input.type)) {
      throw new A2AValidationError(
        "type",
        `type must be one of ${A2A_MESSAGE_TYPES.join(" | ")} (got ${JSON.stringify(input.type)}).`,
      );
    }
    if (input.body === undefined) {
      throw new A2AValidationError("body", "body is required (any JSON value, ≤ 32 KB).");
    }
    const serialized = JSON.stringify(input.body);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > A2A_MAX_BODY_BYTES) {
      throw new A2AValidationError(
        "body",
        `body is ${bytes} bytes serialized; the relay limit is ${A2A_MAX_BODY_BYTES} bytes (32 KB).`,
      );
    }
    if (input.ttl_s !== undefined) {
      if (!Number.isFinite(input.ttl_s) || input.ttl_s < A2A_MIN_TTL_S || input.ttl_s > A2A_MAX_TTL_S) {
        throw new A2AValidationError(
          "ttl_s",
          `ttl_s must be between ${A2A_MIN_TTL_S} and ${A2A_MAX_TTL_S} seconds (got ${input.ttl_s}).`,
        );
      }
    }
    const { status, body } = await this.request(
      "/a2a/send",
      {
        method: "POST",
        body: JSON.stringify({
          to: input.to,
          type: input.type,
          body: input.body,
          ...(input.thread_id ? { thread_id: input.thread_id } : {}),
          ...(input.ttl_s !== undefined ? { ttl_s: input.ttl_s } : {}),
        }),
      },
      { auth: true },
    );
    const obj = assertPlainObjectish(body, status);
    return {
      ok: obj.ok === true,
      message_id: String(obj.message_id ?? obj.id ?? ""),
      delivered_to: String(obj.delivered_to ?? input.to),
      ...(typeof obj.thread_id === "string" ? { thread_id: obj.thread_id } : {}),
    };
  }

  /**
   * GET /a2a/inbox (Bearer). `wait_s` long-polls up to 25s.
   * Messages stay in the inbox until ack()ed.
   */
  async inbox(opts: { thread_id?: string; wait_s?: number } = {}): Promise<A2AInboxResult> {
    if (opts.wait_s !== undefined) {
      if (!Number.isFinite(opts.wait_s) || opts.wait_s < 0 || opts.wait_s > A2A_MAX_WAIT_S) {
        throw new A2AValidationError(
          "wait_s",
          `wait_s must be between 0 and ${A2A_MAX_WAIT_S} seconds (got ${opts.wait_s}).`,
        );
      }
    }
    const q = new URLSearchParams();
    if (opts.thread_id) q.set("thread_id", opts.thread_id);
    if (opts.wait_s !== undefined) q.set("wait_s", String(opts.wait_s));
    const qs = q.toString();
    const { status, body } = await this.request(`/a2a/inbox${qs ? `?${qs}` : ""}`, {}, { auth: true });
    const obj = assertPlainObjectish(body, status);
    return {
      ok: obj.ok === true,
      messages: Array.isArray(obj.messages) ? (obj.messages as A2AMessage[]) : [],
    };
  }

  /** POST /a2a/ack (Bearer) — acknowledge processed messages. */
  async ack(message_ids: string[]): Promise<A2AAckResult> {
    if (!Array.isArray(message_ids) || message_ids.length === 0) {
      throw new A2AValidationError("message_ids", "message_ids must be a non-empty array of message ids.");
    }
    const { status, body } = await this.request(
      "/a2a/ack",
      { method: "POST", body: JSON.stringify({ message_ids }) },
      { auth: true },
    );
    const obj = assertPlainObjectish(body, status);
    return { ok: obj.ok === true, acked: typeof obj.acked === "number" ? obj.acked : message_ids.length };
  }
}

export function createA2AClient(config: A2AClientConfig = {}): A2AClient {
  return new A2AClient(config);
}

export interface ConnectA2AInput extends A2ARegisterInput {
  baseUrl?: string;
  tokenStore?: A2ATokenStore;
  fetchImpl?: typeof fetch;
}

export interface ConnectA2AResult {
  client: A2AClient;
  handle: string;
  /** True when a token already sat in the store and no registration call was made. */
  reused: boolean;
  /** Present only when this call performed the registration. */
  registration?: A2ARegisterResult;
}

/**
 * Register-or-reuse convenience. If the configured token store
 * already holds a token, it is reused as-is (the relay has no
 * token-introspection endpoint, so reuse is by construction: the
 * caller's store is keyed to this handle by the caller). Otherwise
 * the handle is registered — and if the relay says the handle is
 * taken, A2AHandleTakenError surfaces. A different handle is NEVER
 * auto-generated silently.
 */
export async function connectA2A(input: ConnectA2AInput): Promise<ConnectA2AResult> {
  validateHandle(input.handle);
  const client = createA2AClient({
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    ...(input.tokenStore ? { tokenStore: input.tokenStore } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  });
  const existing = await client.tokenStore.get();
  if (existing) {
    return { client, handle: input.handle, reused: true };
  }
  const registration = await client.register({
    handle: input.handle,
    display_name: input.display_name,
    model: input.model,
    ...(input.capabilities ? { capabilities: input.capabilities } : {}),
  });
  return { client, handle: input.handle, reused: false, registration };
}
