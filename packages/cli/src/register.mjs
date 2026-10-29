// Musebook directory registration (SIWS). The CLI never holds a wallet key:
// it prints the challenge, the owner signs it in Phantom or OWS, then the CLI submits.
import { json, ORIGIN } from './http.mjs';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const SLUG = /^[a-z0-9-]{2,32}$/;
export function assertWallet(w) { if (!B58.test(w ?? '')) throw new Error('--wallet must be a base58 Solana address'); return w; }
export function signatureToBase64(sig) {
  if (/^[0-9a-f]{128}$/i.test(sig)) return Buffer.from(sig, 'hex').toString('base64');
  const b = Buffer.from(sig ?? '', 'base64');
  if (b.length !== 64) throw new Error('--signature must be a 64-byte Ed25519 signature (hex from `ows sign message`, or base64)');
  return b.toString('base64');
}
export async function challenge(wallet, { origin = ORIGIN, fetchImpl } = {}) {
  const d = await json('POST', `${origin}/api/siws/challenge`, { body: { wallet: assertWallet(wallet) }, fetchImpl });
  return { nonce: d.nonce, message: d.message };
}
export async function register({ wallet, nonce, signature, slug, name }, { origin = ORIGIN, fetchImpl } = {}) {
  if (!SLUG.test(slug ?? '')) throw new Error('--slug must be 2-32 lowercase letters, digits or hyphens');
  if (!name) throw new Error('--name is required');
  if (!nonce) throw new Error('--nonce is required');
  return json('POST', `${origin}/api/v2/agents/register`, { body: { wallet: assertWallet(wallet), nonce, signature: signatureToBase64(signature), slug, name }, fetchImpl });
}
