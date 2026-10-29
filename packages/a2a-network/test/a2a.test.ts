import { describe, it, expect } from "vitest";
import { generateKeyPairSync, verify, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MusebookA2A, validateAgentCard, jsonRpcInterface, agentJwt, connect, clientFromIdentity,
  networkServices, routeFromRegistration, verifyPeer, discoverNetwork, MESSAGING_SCOPES,
} from "@themusebook/agent-kit-a2a-network";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const rootCard = fx("root-agent-card.json");
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body });
type Call = { url: string; init: any };
function mockFetch(routes: Record<string, (c: Call) => any>) {
  const calls: Call[] = [];
  const f = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    const key = `${init.method ?? "GET"} ${new URL(url).pathname}`;
    const h = routes[key];
    if (!h) return ok({ ok: false, error: "not_found" }, 404);
    return ok(h({ url, init }));
  };
  return { f, calls };
}
const decode = (jwt: string) => jwt.split(".").slice(0, 2).map((p) => JSON.parse(Buffer.from(p, "base64url").toString()));
const peerCard = (tenant = "AGENT123") => ({ ...rootCard, name: "peer", supportedInterfaces: [{ url: "https://musebook.trade/api/auth/capability/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0", tenant }] });

describe("agent cards (A2A 1.0 shape)", () => {
  it("live root card recorded 2026-10-29 validates", () => {
    expect(validateAgentCard(rootCard)).toEqual([]);
    expect(jsonRpcInterface(rootCard).url).toBe("https://musebook.trade/api/auth/capability/a2a");
  });
  it("legacy clawd-a2a/0.1 manifest is NOT an A2A card", () => {
    const p = validateAgentCard(fx("relay-manifest.json"));
    expect(p).toContain("supportedInterfaces must be a non-empty array");
    expect(p.length).toBeGreaterThan(2);
  });
  it("rejects cards without a 1.x JSONRPC interface", () => {
    expect(() => jsonRpcInterface({ ...rootCard, supportedInterfaces: [{ url: "x", protocolBinding: "GRPC", protocolVersion: "1.0" }] })).toThrow();
  });
});

describe("listing", () => {
  it("merges the x402m directory and the legacy relay roster", async () => {
    const { f } = mockFetch({
      "GET /api/x402m/agents": () => ({ protocol: "x402m/1", agents: [{ agent_id: "A1", handle: "muse-peer", name: "Muse", description: "" }] }),
      "GET /a2a/agents": () => fx("relay-agents.json"),
    });
    const all = await new MusebookA2A({ fetchImpl: f }).listAll();
    const muse = all.find((a) => a.handle === "muse-peer")!;
    expect(muse).toMatchObject({ a2a: true, relay: false, agentId: "A1" });
    const clawd = all.find((a) => a.handle === "clawd")!;
    expect(clawd).toMatchObject({ a2a: false, relay: true });
  });
  it("still lists when one roster is down", async () => {
    const { f } = mockFetch({ "GET /a2a/agents": () => fx("relay-agents.json") });
    expect((await new MusebookA2A({ fetchImpl: f }).listAll()).length).toBe(2);
  });
  it("card() hits the per-handle card path and rejects bad handles", async () => {
    const { f, calls } = mockFetch({ "GET /api/x402m/agents/muse-peer/agent-card.json": () => peerCard() });
    await new MusebookA2A({ fetchImpl: f }).card("muse-peer");
    expect(calls[0].url).toBe("https://musebook.trade/api/x402m/agents/muse-peer/agent-card.json");
    expect(() => new MusebookA2A({ fetchImpl: f }).card("../x")).toThrow();
  });
  it("refuses non-HTTPS origins", () => {
    expect(() => new MusebookA2A({ origin: "http://evil.example" })).toThrow();
  });
});

describe("sending (A2A 1.0 JSON-RPC)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  it("sends SendMessage with tenant, PascalCase/ROLE_USER, version headers and a request-bound JWT", async () => {
    const { f, calls } = mockFetch({
      "GET /api/x402m/agents/muse-peer/agent-card.json": () => peerCard("T-1"),
      "POST /api/auth/capability/a2a": () => ({ jsonrpc: "2.0", id: "1", result: { task: { id: "t", status: { state: "TASK_STATE_SUBMITTED" } } } }),
    });
    const c = new MusebookA2A({ fetchImpl: f, agentId: "AG", privateKey });
    const r = await c.send("muse-peer", "hi");
    expect(r.task.status.state).toBe("TASK_STATE_SUBMITTED");
    const post = calls[1];
    const body = JSON.parse(post.init.body);
    expect(body).toMatchObject({ jsonrpc: "2.0", method: "SendMessage", params: { tenant: "T-1", message: { role: "ROLE_USER", parts: [{ text: "hi" }] }, configuration: { returnImmediately: true } } });
    expect(post.init.headers["a2a-version"]).toBe("1.0");
    const jwt = post.init.headers.authorization.slice(7);
    const [h, p] = decode(jwt);
    expect(h).toEqual({ alg: "EdDSA", typ: "agent+jwt" });
    expect(p).toMatchObject({ sub: "AG", aud: "https://musebook.trade/api/auth/capability/execute", htm: "POST", htu: "https://musebook.trade/api/auth/capability/a2a", capabilities: ["x402m.send"] });
    expect(p.ath).toBe(createHash("sha256").update(post.init.body).digest("base64url"));
    const [a, b, s] = jwt.split(".");
    expect(verify(null, Buffer.from(`${a}.${b}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
  it("read methods use the inbox scope", async () => {
    const { f, calls } = mockFetch({ "POST /api/auth/capability/a2a": () => ({ result: { tasks: [] } }) });
    await new MusebookA2A({ fetchImpl: f, agentId: "AG", privateKey }).listTasks();
    expect(decode(calls[0].init.headers.authorization.slice(7))[1].capabilities).toEqual(["x402m.inbox"]);
  });
  it("surfaces JSON-RPC errors and refuses to send unconnected", async () => {
    const { f } = mockFetch({ "POST /api/auth/capability/a2a": () => ({ error: { code: -32001, message: "TaskNotFound" } }) });
    await expect(new MusebookA2A({ fetchImpl: f, agentId: "AG", privateKey }).getTask("x")).rejects.toThrow(/-32001/);
    await expect(new MusebookA2A({ fetchImpl: f }).listTasks()).rejects.toThrow(/musebook connect/);
  });
  it("agentJwt expires in 60s", () => {
    const [, p] = decode(agentJwt({ agentId: "a", privateKey, url: "https://musebook.trade/x", body: "{}", now: 100 }));
    expect(p.exp - p.iat).toBe(60);
  });
});

describe("connect (owner SIWS, no wallet keys)", () => {
  const routes = () => mockFetch({
    "POST /api/siws/challenge": () => ({ ok: true, message: "musebook.trade wants you to sign in", nonce: "N" }),
    "POST /api/siws/verify": () => ({ ok: true, session: "SESSION" }),
    "POST /api/auth/host/create": () => ({ hostId: "H" }),
    "POST /api/auth/agent/register": () => ({ agent_id: "AG", status: "pending", approval: { user_code: "ABCD-EFGH" } }),
    "POST /api/auth/agent/approve-capability": () => ({ ok: true }),
    "POST /api/auth/capability/execute": () => ({ data: { handle: "my-agent" } }),
  });
  const wallet = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
  it("runs challenge → owner signs → verify → host → agent → approve → x402m.register", async () => {
    const { f, calls } = routes();
    const saved: Record<string, any> = {};
    const signed: string[] = [];
    const r = await connect({ wallet, handle: "my-agent", name: "My Agent", fetchImpl: f, signMessage: (m: string) => { signed.push(m); return "SIG"; }, save: (n: string, d: unknown) => { saved[n] = d; } });
    expect(signed).toEqual(["musebook.trade wants you to sign in"]);
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/siws/challenge", "/api/siws/verify", "/api/auth/host/create", "/api/auth/agent/register", "/api/auth/agent/approve-capability", "/api/auth/capability/execute"]);
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ wallet, nonce: "N", signature: "SIG" });
    expect(JSON.parse(calls[3].init.body).capabilities).toEqual(MESSAGING_SCOPES);
    expect(decode(calls[3].init.headers.authorization.slice(7))[0].typ).toBe("host+jwt");
    expect(JSON.parse(calls[5].init.body)).toEqual({ capability: "x402m.register", arguments: { handle: "my-agent", name: "My Agent" } });
    expect(r).toMatchObject({ agentId: "AG", hostId: "H", cardUrl: "https://musebook.trade/api/x402m/agents/my-agent/agent-card.json" });
    expect(Object.keys(saved).sort()).toEqual(["agent.private.jwk", "host.private.jwk", "identity.json"]);
    expect(saved["agent.private.jwk"]).toMatchObject({ kty: "OKP", crv: "Ed25519" });
    const c = clientFromIdentity({ identity: saved["identity.json"], agentJwk: saved["agent.private.jwk"], fetchImpl: f });
    expect(c).toBeInstanceOf(MusebookA2A);
  });
  it("validates inputs before any network call", async () => {
    const { f, calls } = routes();
    await expect(connect({ wallet: "nope", handle: "my-agent", name: "x", fetchImpl: f, signMessage: () => "", save: () => {} })).rejects.toThrow(/wallet/);
    await expect(connect({ wallet, handle: "Bad Handle", name: "x", fetchImpl: f, signMessage: () => "", save: () => {} })).rejects.toThrow(/handle/);
    expect(calls).toHaveLength(0);
  });
  it("clientFromIdentity refuses non-Ed25519 / wallet-shaped keys", () => {
    expect(() => clientFromIdentity({ identity: { origin: "https://musebook.trade", agentId: "a" }, agentJwk: { kty: "EC" } })).toThrow(/Ed25519/);
  });
});

describe("network (Metaplex-first)", () => {
  const COL = "CoLLectionAddr1111111111111111111111111111";
  const doc = { services: networkServices({ handle: "muse-peer" }) };
  it("services[] round-trip to a route", () => {
    expect(routeFromRegistration(doc)).toEqual({ cardUrl: "https://musebook.trade/api/x402m/agents/muse-peer/agent-card.json", handle: "muse-peer", version: "1.0" });
    expect(routeFromRegistration({ services: [] })).toBeNull();
  });
  it("verifyPeer checks collection, burn and handle", () => {
    const asset = { id: "A", grouping: [{ group_key: "collection", group_value: COL }] };
    expect(verifyPeer({ asset, doc, collection: COL, claimedHandle: "muse-peer" }).ok).toBe(true);
    expect(verifyPeer({ asset: { ...asset, burnt: true }, doc, collection: COL }).problems).toContain("asset is burned");
    expect(verifyPeer({ asset: { id: "A", grouping: [] }, doc, collection: COL }).problems).toContain("asset is not in the network collection");
    expect(verifyPeer({ asset, doc, collection: COL, claimedHandle: "other" }).ok).toBe(false);
  });
  it("discoverNetwork queries DAS getAssetsByGroup and resolves routes", async () => {
    const bodies: any[] = [];
    const f = async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return ok({ result: { items: [
      { id: "A", ownership: { owner: "O" }, content: { json_uri: "https://x/a.json", metadata: { name: "a" } }, grouping: [{ group_key: "collection", group_value: COL }] },
      { id: "B", content: {}, grouping: [{ group_key: "collection", group_value: COL }] },
    ] } }); };
    const r = await discoverNetwork({ rpc: "https://rpc", collection: COL, fetchImpl: f, fetchDoc: async () => doc });
    expect(bodies[0]).toMatchObject({ method: "getAssetsByGroup", params: { groupKey: "collection", groupValue: COL } });
    expect(r[0]).toMatchObject({ asset: "A", owner: "O", ok: true });
    expect(r[1].ok).toBe(false);
    await expect(discoverNetwork({ rpc: "", collection: COL })).rejects.toThrow(/MUSEBOOK_NETWORK_COLLECTION/);
  });
});
