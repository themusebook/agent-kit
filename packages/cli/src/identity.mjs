// Metaplex agent identity: reads and an UNSIGNED mint. Program ids come from the Metaplex packages.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { publicKey } from '@metaplex-foundation/umi';
import { mplAgentIdentity, findAgentIdentityV1Pda, safeFetchAgentIdentityV1, mintAgent, MPL_AGENT_IDENTITY_PROGRAM_ID } from '@metaplex-foundation/mpl-agent-registry';
import { mplCore, findAssetSignerPda, fetchAsset, MPL_CORE_PROGRAM_ID } from '@metaplex-foundation/mpl-core';
import { DEVNET_RPC_URL, MAINNET_RPC_URL } from '@x402/svm';
import { ORIGIN } from './http.mjs';
import { assertWallet } from './register.mjs';
export const RPC = { 'solana-devnet': DEVNET_RPC_URL, 'solana-mainnet': MAINNET_RPC_URL };
export { MPL_AGENT_IDENTITY_PROGRAM_ID, MPL_CORE_PROGRAM_ID };
export function umiFor(network, rpc) {
  if (!RPC[network]) throw new Error('--network must be solana-devnet or solana-mainnet');
  return createUmi(rpc || RPC[network]).use(mplCore()).use(mplAgentIdentity());
}
export async function readIdentity(asset, { network = 'solana-devnet', rpc, umi = umiFor(network, rpc) } = {}) {
  const a = publicKey(asset);
  const [identityPda] = findAgentIdentityV1Pda(umi, { asset: a });
  const [assetSigner] = findAssetSignerPda(umi, { asset: a });
  const [core, identity] = await Promise.all([fetchAsset(umi, a).catch(() => null), safeFetchAgentIdentityV1(umi, identityPda)]);
  return { network, asset: String(a), coreAsset: Boolean(core), name: core?.name ?? null, owner: core ? String(core.owner) : null, isAgent: Boolean(identity), identityPda: String(identityPda), assetSigner: String(assetSigner) };
}
export function registration({ name, description, x402mHandle }) {
  return {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1', name, description,
    services: [
      { name: 'web', endpoint: `${ORIGIN}/agents` },
      { name: 'x402m-discovery', endpoint: `${ORIGIN}/api/x402m/discovery` },
      ...(x402mHandle ? [{ name: 'x402m', endpoint: `${ORIGIN}/api/x402m/agents`, handle: x402mHandle }] : []),
    ],
    active: true, registrations: [], supportedTrust: ['reputation'],
  };
}
// Calls the Metaplex Agent API (mintAgent) only; returns an unsigned Core asset + Agent Registry tx.
export async function prepareMint({ network = 'solana-devnet', wallet, name, uri, description = '', x402mHandle, rpc }, { umi = umiFor(network, rpc), mint = mintAgent } = {}) {
  assertWallet(wallet);
  if (!name) throw new Error('--name is required');
  if (!/^https:\/\//.test(uri ?? '')) throw new Error('--uri must be a public https URL to the Core asset metadata JSON');
  const res = await mint(umi, {}, { wallet: publicKey(wallet), network, name, uri, agentMetadata: registration({ name, description, x402mHandle }) });
  const bytes = umi.transactions.serialize(res.transaction);
  return { network, assetAddress: String(res.assetAddress), base64: Buffer.from(bytes).toString('base64'), hex: Buffer.from(bytes).toString('hex'), signed: false, umi, transaction: res.transaction };
}
// Simulates without signatures (sigVerify off) so the owner can review effects before signing.
export async function simulate(umi, base64) {
  const r = await umi.rpc.call('simulateTransaction', [base64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
  return { err: r.value.err, unitsConsumed: r.value.unitsConsumed, logs: r.value.logs?.slice(-8) };
}
