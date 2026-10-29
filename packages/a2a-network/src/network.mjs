// Musebook agent network on Solana — Metaplex-first design (see docs/NETWORK.md).
//   identity   = MPL Core asset + Agent Registry identity PDA (+ Asset Signer PDA as the agent's wallet)
//   membership = the asset belongs to the musebook network Core collection (and/or a team collection)
//   routing    = the asset's registration document lists services[] { name: 'A2A' | 'x402m', endpoint }
//   discovery  = DAS searchAssets { isAgent: true, interface: 'MplCoreAsset' } (+ grouping by collection)
//   liveness   = off-chain (A2A relay last_seen / x402m directory); no per-heartbeat transactions
import { ORIGIN } from './index.mjs';

/** Collection address is set by dev after creating the collection (never hard-coded here). */
export const NETWORK_COLLECTION_ENV = 'MUSEBOOK_NETWORK_COLLECTION';

/** services[] entries to put in an agent's Metaplex registration document so peers can route to it. */
export function networkServices({ handle, origin = ORIGIN }) {
  if (!/^[a-z][a-z0-9_-]{2,31}$/.test(String(handle))) throw new Error('invalid handle');
  const o = new URL(origin).origin;
  return [
    { name: 'A2A', endpoint: `${o}/api/x402m/agents/${handle}/agent-card.json`, version: '1.0' },
    { name: 'x402m', endpoint: `${o}/x402m/${handle}` },
  ];
}

/** Given a registration document, return how to reach the agent (A2A card URL + x402m handle). */
export function routeFromRegistration(doc) {
  const services = Array.isArray(doc?.services) ? doc.services : [];
  const a2a = services.find((s) => String(s?.name).toUpperCase() === 'A2A');
  if (!a2a?.endpoint) return null;
  const m = /\/api\/x402m\/agents\/([a-z][a-z0-9_-]{2,31})\/agent-card\.json$/.exec(a2a.endpoint);
  return { cardUrl: a2a.endpoint, handle: m ? m[1] : undefined, version: a2a.version };
}

/**
 * Verified peer: the on-chain asset is in the network collection, is not burned,
 * and its registration doc routes to the handle it claims. `asset` is a DAS asset.
 */
export function verifyPeer({ asset, doc, collection, claimedHandle }) {
  const problems = [];
  if (!asset?.id) problems.push('missing asset');
  if (asset?.burnt) problems.push('asset is burned');
  const groups = (asset?.grouping || []).filter((g) => g.group_key === 'collection').map((g) => g.group_value);
  if (collection && !groups.includes(collection)) problems.push('asset is not in the network collection');
  const route = routeFromRegistration(doc);
  if (!route) problems.push('registration has no A2A service');
  else if (claimedHandle && route.handle !== claimedHandle) problems.push('A2A service handle does not match');
  return { ok: problems.length === 0, problems, route };
}

/** Registration URI: the AgentIdentity plugin's uri (DAS external_plugins), else the Core metadata json_uri. */
export function registrationUri(asset) {
  const p = (asset?.external_plugins || []).find((x) => x?.type === 'AgentIdentity');
  return p?.adapter_config?.uri || asset?.content?.json_uri || null;
}

/**
 * DAS searchAssets params for agent discovery (Metaplex read-agent-data docs):
 * params are camelCase (isAgent, agentToken, assetSigner); responses come back
 * snake_case (is_agent, asset_signer, agent_token). interface is pinned to
 * MplCoreAsset so collections/groups (which may carry is_agent:false) are excluded.
 */
export function agentSearchParams({ collection, agentToken, assetSigner, owner, limit = 100, page = 1 } = {}) {
  const p = { interface: 'MplCoreAsset', isAgent: true, limit, page };
  if (collection) p.grouping = ['collection', collection];
  if (agentToken) p.agentToken = agentToken;
  if (assetSigner) p.assetSigner = assetSigner;
  if (owner) p.ownerAddress = owner;
  return p;
}

/**
 * Discover agents via DAS searchAssets (isAgent:true, MplCoreAsset) on any
 * DAS RPC with Metaplex agent-registry indexing, resolving each route from
 * the AgentIdentity registration document. `collection` narrows to the
 * musebook network collection; omit it to discover every registered agent.
 */
export async function discoverNetwork({ rpc, collection, agentToken, assetSigner, owner, fetchImpl = globalThis.fetch, limit = 100, page = 1, fetchDoc }) {
  if (!rpc) throw new Error(`rpc required (a DAS RPC; optionally set ${NETWORK_COLLECTION_ENV} to narrow to the network collection)`);
  const r = await fetchImpl(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'mb-net', method: 'searchAssets', params: agentSearchParams({ collection, agentToken, assetSigner, owner, limit, page }) }) });
  if (r.ok === false) throw new Error(`DAS searchAssets: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`DAS error: ${j.error.message}`);
  const getDoc = fetchDoc || (async (uri) => { const d = await fetchImpl(uri); if (d.ok === false) throw new Error(`HTTP ${d.status}`); return d.json(); });
  const items = j.result?.items ?? [];
  return Promise.all(items.map(async (asset) => {
    let doc = null;
    const uri = registrationUri(asset);
    try { if (uri) doc = await getDoc(uri); } catch { /* unreachable doc = unroutable */ }
    const v = verifyPeer({ asset, doc, collection });
    if (asset.is_agent === false) { v.ok = false; v.problems.push('DAS is_agent is false'); }
    return { asset: asset.id, owner: asset.ownership?.owner, name: asset.content?.metadata?.name ?? doc?.name, isAgent: asset.is_agent === true, assetSigner: asset.asset_signer ?? null, agentToken: asset.agent_token ?? null, registrationUri: uri, ...v };
  }));
}
