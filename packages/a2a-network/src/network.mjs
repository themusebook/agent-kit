// Musebook agent network on Solana — Metaplex-first design (see docs/NETWORK.md).
//   identity   = MPL Core asset + Agent Registry identity PDA (+ Asset Signer PDA as the agent's wallet)
//   membership = the asset belongs to the musebook network Core collection (and/or a team collection)
//   routing    = the asset's registration document lists services[] { name: 'A2A' | 'x402m', endpoint }
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

/** List network members via DAS getAssetsByGroup (any Helius/DAS RPC), resolving each route. */
export async function discoverNetwork({ rpc, collection, fetchImpl = globalThis.fetch, limit = 100, fetchDoc }) {
  if (!rpc || !collection) throw new Error(`rpc and collection required (set ${NETWORK_COLLECTION_ENV})`);
  const r = await fetchImpl(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'mb-net', method: 'getAssetsByGroup', params: { groupKey: 'collection', groupValue: collection, page: 1, limit } }) });
  const j = await r.json();
  if (j.error) throw new Error(`DAS error: ${j.error.message}`);
  const getDoc = fetchDoc || (async (uri) => (await fetchImpl(uri)).json());
  const items = j.result?.items ?? [];
  return Promise.all(items.map(async (asset) => {
    let doc = null;
    try { if (asset.content?.json_uri) doc = await getDoc(asset.content.json_uri); } catch { /* unreachable doc = unroutable */ }
    const v = verifyPeer({ asset, doc, collection });
    return { asset: asset.id, owner: asset.ownership?.owner, name: asset.content?.metadata?.name, ...v };
  }));
}
