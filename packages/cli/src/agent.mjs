// `musebook agent ...` — Metaplex agent READ (SDK + DAS) and RUN (UNSIGNED txs only).
// Sources: https://www.metaplex.com/docs/agents/read-agent-data , /run-an-agent (verified 2026-10-29
// against mpl-agent-registry 0.2.6 / mpl-core 1.10.0 / mpl-toolbox 0.10.0 types).
// Nothing here signs or sends: every signer is a umi noop signer and no keypair is generated.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, publicKey, signerIdentity } from '@metaplex-foundation/umi';
import {
  mplAgentIdentity, mplAgentTools, safeFetchAgentIdentityV1, findAgentIdentityV1Pda,
  findExecutiveProfileV1Pda, findExecutionDelegateRecordV1Pda,
  registerExecutiveV1, delegateExecutionV1, revokeExecutionV1,
} from '@metaplex-foundation/mpl-agent-registry';
import { mplCore, fetchAsset, findAssetSignerPda, execute, CheckResult } from '@metaplex-foundation/mpl-core';
import { mplToolbox, revokeTokenDelegate, findAssociatedTokenPda } from '@metaplex-foundation/mpl-toolbox';
import { RPC } from './identity.mjs';

export const FUND_WARNING = 'Send funds to the Asset Signer, not the asset address: they are two different addresses.';
export const OPERATIONAL_AUTHORITY = "Operational authority: an execution delegate may cause the agent's Asset Signer PDA to sign ANY instruction passed through Core's Execute hook. Delegate only to operators you trust.";
export const REVOKE_SCOPE = 'Revocation stops FUTURE Execute calls from this executive; it does not unwind state from previous executions (SPL approvals, escrows, delegated authorities). Use `agent cleanup-approval` for SPL approvals.';

const rpcOf = (network = 'solana-devnet', rpc) => { if (!rpc && !RPC[network]) throw new Error('--network must be solana-devnet or solana-mainnet'); return rpc || RPC[network]; };
export const agentUmi = (url) => createUmi(url).use(mplToolbox()).use(mplCore()).use(mplAgentIdentity()).use(mplAgentTools());
const s = (pda) => String(Array.isArray(pda) ? pda[0] : pda);
const need = (v, flag) => { if (!v || v === true) throw new Error(`--${flag} is required`); return publicKey(v); };
const listens = (v) => Array.isArray(v) ? v.includes(CheckResult.CAN_LISTEN) : v?.__kind === 'Listen';

async function das(url, method, params, fetchImpl = globalThis.fetch) {
  const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  if (!r.ok) throw new Error(`DAS ${method}: HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`DAS ${method}: ${j.error.message}`);
  return j.result;
}
const dasView = (umi, a) => {
  const derived = s(findAssetSignerPda(umi, { asset: publicKey(a.id) }));
  return { id: a.id, isAgent: a.is_agent === true, assetSigner: a.asset_signer ?? null, agentToken: a.agent_token ?? null, derivedAssetSigner: derived, signerAgrees: a.asset_signer ? a.asset_signer === derived : null };
};
/** searchAssets params: camelCase, interface pinned to MplCoreAsset. */
export function searchParams(f) {
  const p = { interface: 'MplCoreAsset', limit: Number(f.limit ?? 100) };
  if (f.agentToken) p.agentToken = f.agentToken;
  if (f.assetSigner) p.assetSigner = f.assetSigner;
  if (!f.agentToken && !f.assetSigner) p.isAgent = true;
  return p;
}

export async function readAgent(asset, f = {}, { umi, fetchImpl } = {}) {
  const url = rpcOf(f.network, f.rpc); umi ??= agentUmi(url);
  const a = need(asset, 'asset');
  const idPda = findAgentIdentityV1Pda(umi, { asset: a });
  const [identity, core] = await Promise.all([safeFetchAgentIdentityV1(umi, idPda), fetchAsset(umi, a).catch(() => null)]);
  const plugin = core?.agentIdentities?.[0];
  const out = {
    asset: String(a), registered: identity !== null, identityPda: s(idPda), owner: core ? String(core.owner) : null,
    plugin: plugin ? { uri: plugin.uri, lifecycleChecks: Object.fromEntries(['transfer', 'update', 'execute'].map((k) => [k, listens(plugin.lifecycleChecks?.[k])])) } : null,
  };
  if (plugin?.uri) {
    const r = await (fetchImpl ?? globalThis.fetch)(plugin.uri);
    if (!r.ok) throw new Error(`Registration document fetch failed: HTTP ${r.status}`);
    const doc = await r.json();
    out.registration = { name: doc.name, description: doc.description, active: doc.active, services: doc.services ?? [], registrations: doc.registrations ?? [] };
  }
  if (f.das) out.das = dasView(umi, await das(f.das === true ? url : f.das, 'getAsset', { id: String(a) }, fetchImpl));
  return out;
}

export async function agentWallet(asset, f = {}, { umi } = {}) {
  umi ??= agentUmi(rpcOf(f.network, f.rpc));
  const pda = findAssetSignerPda(umi, { asset: need(asset, 'asset') });
  const bal = await umi.rpc.getBalance(pda[0]);
  return { asset: String(asset), assetSigner: s(pda), lamports: bal.basisPoints.toString(), warning: FUND_WARNING };
}

export async function searchAgents(f = {}, { umi, fetchImpl } = {}) {
  const url = typeof f.das === 'string' ? f.das : rpcOf(f.network, f.rpc); umi ??= agentUmi(url);
  const r = await das(url, 'searchAssets', searchParams(f), fetchImpl);
  return (r?.items ?? []).map((a) => dasView(umi, a));
}

async function unsigned(url, wallet, build, f, meta) {
  const umi = agentUmi(url).use(signerIdentity(createNoopSigner(wallet)));
  const tb = build(umi);
  const blockhash = f.blockhash ?? (await umi.rpc.getLatestBlockhash()).blockhash;
  const bytes = umi.transactions.serialize(tb.setBlockhash(blockhash).build(umi));
  return { ...meta, signer: String(wallet), signed: false, base64: Buffer.from(bytes).toString('base64'), hex: Buffer.from(bytes).toString('hex') };
}

export function executiveRegister(f) {
  const url = rpcOf(f.network, f.rpc), w = need(f.wallet, 'wallet');
  return unsigned(url, w, (u) => registerExecutiveV1(u, { payer: u.payer, authority: u.identity }), f,
    { action: 'registerExecutiveV1', accounts: { executiveProfile: s(findExecutiveProfileV1Pda(agentUmi(url), { authority: w })) }, warnings: ['One executive profile per wallet; registering twice fails.'] });
}

export function delegate(f) {
  const url = rpcOf(f.network, f.rpc), owner = need(f.wallet, 'wallet'), asset = need(f.asset, 'asset'), ex = need(f.executive, 'executive');
  const u0 = agentUmi(url);
  const agentIdentity = findAgentIdentityV1Pda(u0, { asset }), executiveProfile = findExecutiveProfileV1Pda(u0, { authority: ex });
  return unsigned(url, owner, (u) => delegateExecutionV1(u, { agentAsset: asset, agentIdentity, executiveProfile, payer: u.payer, authority: u.identity }), f, {
    action: 'delegateExecutionV1',
    accounts: { agentIdentity: s(agentIdentity), executiveProfile: s(executiveProfile), executionDelegateRecord: s(findExecutionDelegateRecordV1Pda(u0, { executiveProfile: executiveProfile[0], agentAsset: asset })) },
    warnings: [OPERATIONAL_AUTHORITY, '--wallet must be the asset OWNER; the program rejects any other signer.'],
  });
}

export async function delegation(f, { umi } = {}) {
  umi ??= agentUmi(rpcOf(f.network, f.rpc));
  const profile = findExecutiveProfileV1Pda(umi, { authority: need(f.executive, 'executive') });
  const record = findExecutionDelegateRecordV1Pda(umi, { executiveProfile: profile[0], agentAsset: need(f.asset, 'asset') });
  const acct = await umi.rpc.getAccount(record[0]);
  return { delegated: acct.exists, executiveProfile: s(profile), executionDelegateRecord: s(record) };
}

export function revoke(f) {
  const url = rpcOf(f.network, f.rpc), signer = need(f.wallet, 'wallet'), asset = need(f.asset, 'asset'), ex = need(f.executive, 'executive');
  const destination = f.destination ? publicKey(f.destination) : signer;
  const u0 = agentUmi(url);
  const record = findExecutionDelegateRecordV1Pda(u0, { executiveProfile: findExecutiveProfileV1Pda(u0, { authority: ex })[0], agentAsset: asset });
  return unsigned(url, signer, (u) => revokeExecutionV1(u, { executionDelegateRecord: record, agentAsset: asset, destination, payer: u.payer, authority: u.identity }), f, {
    action: 'revokeExecutionV1', accounts: { executionDelegateRecord: s(record), destination: String(destination) },
    warnings: [REVOKE_SCOPE, '--wallet must be the asset owner or the executive authority on the record.'],
  });
}

export async function cleanupApproval(f, { umi } = {}) {
  const url = rpcOf(f.network, f.rpc), owner = need(f.wallet, 'wallet'), asset = need(f.asset, 'asset');
  let collection = f.collection ? publicKey(f.collection) : undefined;
  if (!collection && !f.noCollection) {
    const a = await fetchAsset(umi ?? agentUmi(url), asset);
    if (a.updateAuthority.type === 'Collection' && a.updateAuthority.address) collection = a.updateAuthority.address;
  }
  const u0 = agentUmi(url), signerPda = findAssetSignerPda(u0, { asset });
  const source = f.tokenAccount ? publicKey(f.tokenAccount) : findAssociatedTokenPda(u0, { mint: need(f.mint, 'mint'), owner: signerPda[0] })[0];
  return unsigned(url, owner, (u) => execute(u, { asset: { publicKey: asset }, ...(collection ? { collection: { publicKey: collection } } : {}), instructions: revokeTokenDelegate(u, { source, owner: createNoopSigner(signerPda[0]) }) }), f, {
    action: 'execute(revokeTokenDelegate)', accounts: { assetSigner: s(signerPda), tokenAccount: String(source), collection: collection ? String(collection) : null },
    warnings: ['Owner-driven: Core Execute validates the asset owner, no active executive required.'],
  });
}

export const AGENT_HELP = `musebook agent read <asset> [--das [URL]]        identity (SDK) + AgentIdentity plugin + registration doc
musebook agent wallet <asset>                     Asset Signer PDA + balance (fund THIS, not the asset)
musebook agent search [--agent-token M | --asset-signer P] [--das URL] [--limit N]   DAS searchAssets
musebook agent executive register --wallet W      unsigned registerExecutiveV1
musebook agent delegate --wallet OWNER --asset A --executive E      unsigned delegateExecutionV1
musebook agent delegation --asset A --executive E                    is the delegate record live?
musebook agent revoke --wallet OWNER|EXEC --asset A --executive E [--destination D]   unsigned revokeExecutionV1
musebook agent cleanup-approval --wallet OWNER --asset A --mint M [--token-account T] [--collection C]
  all: [--network solana-devnet|solana-mainnet] [--rpc URL]; tx commands print UNSIGNED txs only`;

export async function runAgent([sub, ...rest], f) {
  switch (sub) {
    case 'read': return readAgent(rest[0], f);
    case 'wallet': return agentWallet(rest[0], f);
    case 'search': return searchAgents(f);
    case 'executive': if (rest[0] === 'register') return executiveRegister(f); break;
    case 'delegate': return delegate(f);
    case 'delegation': return delegation(f);
    case 'revoke': return revoke(f);
    case 'cleanup-approval': return cleanupApproval(f);
  }
  throw new Error(AGENT_HELP);
}
