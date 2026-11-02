// solana-agent (devnet). Mirrors solana-agent-network src/agent.rs (PR themusebook/solana-agent-network#2).
// Builds documents only; never signs. Owners sign the memo anchor in their own wallet.
import { createHash } from 'node:crypto';
export const AGENT_NAME = 'solana-agent';
export const MPL_AGENT_IDENTITY = '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p';
export const modules = [
  ['x402m-messaging','messaging',true,'live'], ['x402-payments','payments',true,'devnet-proposal-only'],
  ['ore-mining','adapter',false,'simulated'], ['imperial-perps','adapter',false,'simulated'],
  ['phoenix-perps','adapter',false,'simulated'], ['pump-fun','adapter',false,'simulated'],
  ['helius-core-ai','skills',false,'planned'],
].map(([id,kind,enabled,mode]) => ({ id, kind, enabled, mode }));
export function registration({ asset, wallet, endpoint = 'https://registry.musebook.trade', version = 1 }) {
  const e = endpoint.replace(/\/$/, ''), base = `${e}/agents/${asset}`;
  return { type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name: AGENT_NAME,
    description: 'Solana Agent Network agent (devnet)', version,
    services: [{ name: 'A2A', endpoint: `${base}/.well-known/agent-card.json`, version: '0.3.0' },
               { name: 'x402m', endpoint: `${base}/x402m` }, { name: 'MCP', endpoint: `${e}/mcp` }],
    x402: { network: 'solana-devnet', payTo: wallet, endpoint: `${base}/x402` },
    registrations: [{ agentId: asset, agentRegistry: `solana:devnet:${MPL_AGENT_IDENTITY}` }],
    supportedTrust: ['reputation'], modules };
}
const canon = v => Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}` : JSON.stringify(v);
export const contentHash = doc => createHash('sha256').update(canon(doc)).digest('hex');
export const anchorMemo = (asset, version, hash) => `san1:reg:${asset}:${version}:${hash}`;
export function checkDelegation(d, { owner, program, lamports, now, revokedNonce = 0 }) {
  if (owner !== d.ownerAtGrant) throw new Error('asset transferred: delegation void');
  if (d.nonce < revokedNonce) throw new Error('revoked');
  if (now >= d.expiresAt) throw new Error('expired');
  if (!d.programs.includes(program)) throw new Error('program not allowlisted');
  if (d.spentLamports + lamports > d.spendCapLamports) throw new Error('spend cap exceeded');
  return true;
}
