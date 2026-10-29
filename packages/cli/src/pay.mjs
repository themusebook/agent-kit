// x402 on Solana: read a real 402, show exact terms, and only pay via the owner's OWS vault with --yes.
import { spawnSync } from 'node:child_process';
import { USDC_MAINNET_ADDRESS, USDC_DEVNET_ADDRESS, SOLANA_MAINNET_CAIP2, SOLANA_DEVNET_CAIP2, V1_TO_V2_NETWORK_MAP } from '@x402/svm';
import { request } from './http.mjs';
const ASSETS = { [USDC_MAINNET_ADDRESS]: 'USDC', [USDC_DEVNET_ADDRESS]: 'USDC (devnet)' };
const NETWORKS = { [SOLANA_MAINNET_CAIP2]: 'Solana mainnet', [SOLANA_DEVNET_CAIP2]: 'Solana devnet' };
export function parse402(status, headers, body) {
  if (status !== 402) return null;
  const header = headers.get('payment-required');
  const pr = header ? JSON.parse(Buffer.from(header, 'base64').toString('utf8')) : body;
  const accepts = (pr?.accepts ?? []).map((a) => {
    const network = V1_TO_V2_NETWORK_MAP[a.network] ?? a.network;
    const amount = a.amount ?? a.maxAmountRequired;
    return { scheme: a.scheme, network, networkLabel: NETWORKS[network] ?? network, asset: a.asset, assetLabel: ASSETS[a.asset] ?? 'unknown asset', amount, amountUnits: 'atomic', payTo: a.payTo, solana: network?.startsWith('solana:') };
  });
  return { x402Version: pr?.x402Version ?? null, resource: pr?.resource?.url ?? pr?.resource ?? null, accepts };
}
export async function quote(url, { fetchImpl } = {}) {
  const r = await request('GET', url, { fetchImpl });
  return parse402(r.status, r.headers, r.data);
}
export function payWithOws(url, wallet, run = spawnSync) {
  if (!wallet) throw new Error('--wallet <ows wallet name> is required to pay');
  return run('ows', ['pay', 'request', url, '--wallet', wallet], { stdio: 'inherit' }).status;
}
