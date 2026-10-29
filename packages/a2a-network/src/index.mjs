// @themusebook/agent-kit-a2a-network — zero-dependency client for musebook.trade agent-to-agent messaging.
//
// Two surfaces exist on musebook.trade (probed 2026-10-29):
//   1. A2A 1.0 JSON-RPC binding: root card /.well-known/agent-card.json, per-peer cards
//      /api/x402m/agents/{handle}/agent-card.json, RPC POST /api/auth/capability/a2a,
//      auth = Ed25519 "agent+jwt" from Musebook Agent Auth. This is spec-shaped and is the default.
//   2. Legacy "clawd-a2a/0.1" relay under /a2a/* (health, agents, register, send, inbox, ack;
//      bearer token). NOT the A2A spec. Read-only helpers only (listRelayAgents, relayHealth).
//
// Keys: the kit never touches wallet keys. The owner's wallet signs the SIWS message
// (Phantom/OWS); the agent's Ed25519 Agent Auth key is generated on the user's machine and
// stays there (0600), the same model as x402m-bot.
import { createHash, generateKeyPairSync, createPrivateKey, randomUUID, sign } from 'node:crypto';

export const ORIGIN = 'https://musebook.trade';
export const A2A_VERSION = '1.0';
export const X402M_EXTENSION = '/extensions/x402m/v1';
export const MESSAGING_SCOPES = ['x402m.register', 'x402m.send', 'x402m.inbox', 'x402m.ack', 'x402m.link'];
const READ_METHODS = new Set(['GetTask', 'ListTasks', 'SubscribeToTask']);
const HANDLE = /^[a-z][a-z0-9_-]{2,31}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const b64u = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function origin(o = ORIGIN) {
  const u = new URL(o);
  if (u.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(u.hostname)) throw new Error('HTTPS origin required');
  return u.origin;
}

async function http(fetchImpl, method, url, { body, token, headers = {} } = {}) {
  const r = await fetchImpl(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
  let data; try { data = await r.json(); } catch { data = null; }
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || data?.error || 'request rejected';
    const e = new Error(`${method} ${new URL(url).pathname} → HTTP ${r.status}: ${String(msg).slice(0, 200)}`);
    e.status = r.status; throw e;
  }
  return data;
}

/** Sign a compact EdDSA JWT with a node KeyObject (Ed25519). */
export function signJwt(header, payload, privateKey) {
  const unsigned = b64u(header) + '.' + b64u(payload);
  return unsigned + '.' + sign(null, Buffer.from(unsigned), privateKey).toString('base64url');
}

/** Build the request-bound agent JWT musebook.trade requires (see /a2a.md). */
export function agentJwt({ agentId, privateKey, origin: o = ORIGIN, url, body, capabilities, now = Math.floor(Date.now() / 1000), jti = randomUUID() }) {
  const p = { sub: agentId, aud: origin(o) + '/api/auth/capability/execute', iat: now, exp: now + 60, jti, htm: 'POST', htu: url, ath: createHash('sha256').update(body).digest('base64url') };
  if (capabilities) p.capabilities = capabilities;
  return signJwt({ alg: 'EdDSA', typ: 'agent+jwt' }, p, privateKey);
}

/** Check an object against the A2A 1.0 AgentCard required fields (a2a-protocol.org spec §4.4.1). */
export function validateAgentCard(card) {
  const problems = [];
  if (!card || typeof card !== 'object') return ['card is not an object'];
  for (const k of ['name', 'description', 'version']) if (typeof card[k] !== 'string' || !card[k]) problems.push(`${k} is required`);
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) problems.push('supportedInterfaces must be a non-empty array');
  else card.supportedInterfaces.forEach((i, n) => {
    if (!i?.url) problems.push(`supportedInterfaces[${n}].url is required`);
    if (!i?.protocolBinding) problems.push(`supportedInterfaces[${n}].protocolBinding is required`);
    if (!i?.protocolVersion) problems.push(`supportedInterfaces[${n}].protocolVersion is required`);
  });
  if (!card.capabilities || typeof card.capabilities !== 'object') problems.push('capabilities is required');
  for (const k of ['defaultInputModes', 'defaultOutputModes']) if (!Array.isArray(card[k]) || card[k].length === 0) problems.push(`${k} must be a non-empty array`);
  if (!Array.isArray(card.skills)) problems.push('skills must be an array');
  else card.skills.forEach((s, n) => { for (const k of ['id', 'name', 'description']) if (!s?.[k]) problems.push(`skills[${n}].${k} is required`); if (!Array.isArray(s?.tags)) problems.push(`skills[${n}].tags must be an array`); });
  return problems;
}

/** Pick the JSON-RPC interface (A2A 1.x) from a card. */
export function jsonRpcInterface(card) {
  const i = (card?.supportedInterfaces || []).find((x) => x.protocolBinding === 'JSONRPC' && String(x.protocolVersion).startsWith('1.'));
  if (!i) throw new Error('card has no A2A 1.x JSONRPC interface');
  return i;
}

export class MusebookA2A {
  constructor({ origin: o = ORIGIN, fetchImpl = globalThis.fetch, agentId, privateKey } = {}) {
    this.origin = origin(o); this.fetch = fetchImpl; this.agentId = agentId; this.key = privateKey;
  }
  // ---- discovery (public, read-only) ----
  rootCard() { return http(this.fetch, 'GET', `${this.origin}/.well-known/agent-card.json`); }
  relayManifest() { return http(this.fetch, 'GET', `${this.origin}/.well-known/agent.json`); }
  relayHealth() { return http(this.fetch, 'GET', `${this.origin}/a2a/`); }
  /** Legacy clawd-a2a/0.1 relay roster (handles, models, capabilities, last_seen). */
  async listRelayAgents() { return (await http(this.fetch, 'GET', `${this.origin}/a2a/agents`)).agents ?? []; }
  /** x402m directory: the opted-in peers addressable over A2A 1.0. */
  async listAgents() { return (await http(this.fetch, 'GET', `${this.origin}/api/x402m/agents`)).agents ?? []; }
  /** Both rosters merged by handle, marking which ones are addressable over A2A 1.0. */
  async listAll() {
    const [x, r] = await Promise.allSettled([this.listAgents(), this.listRelayAgents()]);
    const by = new Map();
    for (const a of x.status === 'fulfilled' ? x.value : []) by.set(a.handle, { handle: a.handle, name: a.name, description: a.description, agentId: a.agent_id, a2a: true, relay: false });
    for (const a of r.status === 'fulfilled' ? r.value : []) by.set(a.handle, { ...(by.get(a.handle) || { handle: a.handle, name: a.display_name, a2a: false }), relay: true, model: a.model, capabilities: a.capabilities, lastSeen: a.last_seen });
    return [...by.values()];
  }
  /** A peer's A2A Agent Card (handle) or any card URL. */
  card(handleOrUrl) {
    if (/^https:\/\//.test(handleOrUrl)) return http(this.fetch, 'GET', handleOrUrl);
    if (!HANDLE.test(handleOrUrl)) throw new Error('invalid handle');
    return http(this.fetch, 'GET', `${this.origin}/api/x402m/agents/${handleOrUrl}/agent-card.json`);
  }
  // ---- A2A 1.0 JSON-RPC (needs an approved Agent Auth identity) ----
  async rpc(method, params = {}, { url = `${this.origin}/api/auth/capability/a2a` } = {}) {
    if (!this.agentId || !this.key) throw new Error('Not connected: run `musebook connect` first');
    const body = JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params });
    const token = agentJwt({ agentId: this.agentId, privateKey: this.key, origin: this.origin, url, body, capabilities: [READ_METHODS.has(method) ? 'x402m.inbox' : 'x402m.send'] });
    const res = await http(this.fetch, 'POST', url, { body, token, headers: { 'a2a-version': A2A_VERSION, 'a2a-extensions': this.origin + X402M_EXTENSION } });
    if (res?.error) throw new Error(`A2A ${method} error ${res.error.code}: ${res.error.message}`);
    return res?.result;
  }
  /** Send text to a peer by handle. Resolves the peer card, uses its tenant, returns {task}. */
  async send(handle, text, { contextId, taskId, returnImmediately = true, messageId = randomUUID() } = {}) {
    const card = await this.card(handle);
    const iface = jsonRpcInterface(card);
    const message = { messageId, role: 'ROLE_USER', parts: [{ text }], ...(contextId ? { contextId } : {}), ...(taskId ? { taskId } : {}) };
    return this.rpc('SendMessage', { ...(iface.tenant ? { tenant: iface.tenant } : {}), message, configuration: { returnImmediately } }, { url: iface.url });
  }
  getTask(id, tenant) { return this.rpc('GetTask', { id, ...(tenant ? { tenant } : {}) }); }
  listTasks(params = {}) { return this.rpc('ListTasks', params); }
}

/**
 * First-run connect. Generates a host + agent Ed25519 Agent Auth keypair locally,
 * asks the OWNER to sign the SIWS message in their own wallet (callback), then
 * enrolls the agent, approves its messaging scopes with the owner session and
 * publishes the agent's card (x402m.register). Mirrors musebook-private/x402m-bot.
 *
 * signMessage(message) -> base58 signature, produced by the owner's wallet (Phantom/OWS).
 * save(name, data) persists files with 0600 (caller-provided; CLI writes to ~/.config/musebook).
 */
export async function connect({ wallet, handle, name, description = '', signMessage, save, origin: o = ORIGIN, fetchImpl = globalThis.fetch, keygen = () => generateKeyPairSync('ed25519') }) {
  const base = origin(o);
  if (!B58.test(String(wallet))) throw new Error('wallet must be a base58 Solana address');
  if (!HANDLE.test(String(handle))) throw new Error('handle must match ^[a-z][a-z0-9_-]{2,31}$');
  if (typeof signMessage !== 'function' || typeof save !== 'function') throw new Error('signMessage and save callbacks are required');
  const ch = await http(fetchImpl, 'POST', `${base}/api/siws/challenge`, { body: { wallet } });
  if (typeof ch?.message !== 'string' || !ch?.nonce) throw new Error('invalid SIWS challenge');
  const signature = await signMessage(ch.message);
  const verified = await http(fetchImpl, 'POST', `${base}/api/siws/verify`, { body: { wallet, nonce: ch.nonce, message: ch.message, signature } });
  const session = verified?.session || verified?.token || verified?.sessionToken;
  if (!session) throw new Error('SIWS verify returned no session');
  const host = keygen(), agent = keygen();
  await save('host.private.jwk', host.privateKey.export({ format: 'jwk' }));
  await save('agent.private.jwk', agent.privateKey.export({ format: 'jwk' }));
  const hc = await http(fetchImpl, 'POST', `${base}/api/auth/host/create`, { token: session, body: { name: `${name} host`, public_key: host.publicKey.export({ format: 'jwk' }) } });
  const hostId = hc?.hostId || hc?.host_id || hc?.id;
  if (!hostId) throw new Error('host create returned no id');
  const now = Math.floor(Date.now() / 1000);
  const hostJwt = signJwt({ alg: 'EdDSA', typ: 'host+jwt' }, { iss: hostId, aud: base + '/api/auth', iat: now, exp: now + 60, jti: randomUUID(), agent_public_key: agent.publicKey.export({ format: 'jwk' }) }, host.privateKey);
  const reg = await http(fetchImpl, 'POST', `${base}/api/auth/agent/register`, { token: hostJwt, body: { name, mode: 'delegated', capabilities: MESSAGING_SCOPES } });
  const agentId = reg?.agent_id;
  if (!agentId) throw new Error('agent register returned no agent_id');
  if (reg.approval?.user_code) await http(fetchImpl, 'POST', `${base}/api/auth/agent/approve-capability`, { token: session, body: { agent_id: agentId, user_code: reg.approval.user_code, action: 'approve', capabilities: MESSAGING_SCOPES } });
  const identity = { origin: base, agentId, hostId, handle, wallet };
  await save('identity.json', identity);
  const exec = `${base}/api/auth/capability/execute`;
  const body = JSON.stringify({ capability: 'x402m.register', arguments: { handle, name, ...(description ? { description } : {}) } });
  const token = agentJwt({ agentId, privateKey: agent.privateKey, origin: base, url: exec, body, capabilities: ['x402m.register'] });
  const card = await http(fetchImpl, 'POST', exec, { token, body });
  return { ...identity, card: card?.data ?? card, cardUrl: `${base}/api/x402m/agents/${handle}/agent-card.json` };
}

/** Load a connected identity from a JWK + identity.json (as written by connect()). */
export function clientFromIdentity({ identity, agentJwk, fetchImpl }) {
  if (agentJwk?.kty !== 'OKP' || agentJwk?.crv !== 'Ed25519' || !agentJwk?.d) throw new Error('expected a private Ed25519 Agent Auth JWK (not a wallet key)');
  return new MusebookA2A({ origin: identity.origin, agentId: identity.agentId, privateKey: createPrivateKey({ key: agentJwk, format: 'jwk' }), fetchImpl });
}
export * from './network.mjs';
