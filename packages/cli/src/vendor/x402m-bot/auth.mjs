// x402m/1 agent-messaging auth helpers (spec: x402-foundation/x402 agent-messaging).
// Messaging keys only: these tokens can never authorize a payment.
import { createHash, createPublicKey, sign, verify, randomUUID } from 'node:crypto';

export const ALGORITHMS = Object.freeze({ EdDSA: { kty: 'OKP', crv: 'Ed25519' }, ES256K: { kty: 'EC', crv: 'secp256k1' } });
export const AUTH_PROFILES = Object.freeze(['agent-jwt', 'better-auth-agent-auth', 'reason-network']);
// reason-network is informative: an identity binding, never a token format.
export const TOKEN_PROFILES = Object.freeze(['agent-jwt', 'better-auth-agent-auth']);
export const MAX_LIFETIME = 60;
const PAYMENT_FIELDS = ['x-payment', 'payment-signature', 'paymentPayload', 'PaymentPayload', 'facilitator', 'spend', 'payment'];

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

export function algorithmForJwk(jwk) {
  for (const [alg, shape] of Object.entries(ALGORITHMS)) if (jwk?.kty === shape.kty && jwk?.crv === shape.crv) return alg;
  throw new Error('Unsupported agent key: expected Ed25519 (EdDSA) or secp256k1 (ES256K) JWK');
}
export function algorithmForKey(key) {
  if (key.asymmetricKeyType === 'ed25519') return 'EdDSA';
  if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'secp256k1') return 'ES256K';
  throw new Error('Unsupported agent key type');
}
function rawSign(alg, data, key) {
  return alg === 'EdDSA' ? sign(null, data, key) : sign('sha256', data, { key, dsaEncoding: 'ieee-p1363' });
}
function rawVerify(alg, data, key, sig) {
  return alg === 'EdDSA' ? verify(null, data, key, sig) : verify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, sig);
}

export function assertMessagingCapabilities(capabilities) {
  if (!Array.isArray(capabilities) || capabilities.length === 0) throw new Error('capabilities required');
  for (const c of capabilities) if (typeof c !== 'string' || !/^x402m\.[a-z]+$/.test(c)) throw new Error(`Messaging credential cannot carry capability ${c}`);
}

export function signAgentJwt({ privateKey, agentId, url, body, capability, now = Math.floor(Date.now() / 1000), jti = randomUUID() }) {
  assertMessagingCapabilities([capability]);
  const alg = algorithmForKey(privateKey);
  const unsigned = b64({ alg, typ: 'agent+jwt' }) + '.' + b64({ sub: agentId, aud: url, iat: now, exp: now + MAX_LIFETIME, jti, capabilities: [capability], htm: 'POST', htu: url, ath: createHash('sha256').update(body).digest('base64url') });
  return unsigned + '.' + rawSign(alg, Buffer.from(unsigned), privateKey).toString('base64url');
}

// Reference verifier for services/tests. `pinnedAlg` is the algorithm recorded at registration.
export function verifyAgentJwt(token, { publicJwk, pinnedAlg, url, body, now = Math.floor(Date.now() / 1000), seen = new Set() }) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = unb64(parts[0]), claims = unb64(parts[1]);
  if (header.typ !== 'agent+jwt') throw new Error('wrong typ');
  const keyAlg = algorithmForJwk(publicJwk);
  if (header.alg !== keyAlg || (pinnedAlg && header.alg !== pinnedAlg)) throw new Error('algorithm does not match pinned key');
  const key = createPublicKey({ key: publicJwk, format: 'jwk' });
  if (!rawVerify(header.alg, Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw new Error('bad signature');
  if (claims.aud !== url || claims.htu !== url || claims.htm !== 'POST') throw new Error('audience mismatch');
  if (!(claims.exp > now) || claims.iat > now + 5 || claims.exp - claims.iat > MAX_LIFETIME) throw new Error('expired or overlong token');
  if (!claims.jti || seen.has(claims.jti)) throw new Error('jti replay');
  if (body !== undefined && claims.ath !== createHash('sha256').update(body).digest('base64url')) throw new Error('body hash mismatch');
  assertMessagingCapabilities(claims.capabilities);
  seen.add(claims.jti);
  return { agentId: claims.sub, capabilities: claims.capabilities, alg: header.alg };
}

// Invariant: no messaging credential or message can authorize a payment.
export function assertNotPaymentAuthorization(request) {
  const keys = Object.keys(request?.headers ?? {}).map((k) => k.toLowerCase());
  if (keys.some((k) => k === 'x-payment' || k === 'payment-signature')) throw new Error('Messaging requests must not carry payment authorization');
  const args = request?.body?.arguments ?? {};
  for (const f of PAYMENT_FIELDS) if (f in args) throw new Error('Messaging arguments must not carry payment authorization');
  return true;
}

export function selectAuthProfile(descriptor, supported = TOKEN_PROFILES, alg = 'EdDSA') {
  for (const p of descriptor?.authProfiles ?? [{ id: 'agent-jwt', algorithms: ['EdDSA'] }]) {
    if (!TOKEN_PROFILES.includes(p.id) || !supported.includes(p.id)) continue;
    if (p.id === 'agent-jwt' && !(p.algorithms ?? ['EdDSA']).includes(alg)) continue;
    if (p.id === 'better-auth-agent-auth' && alg !== 'EdDSA') continue; // plugin default allowedKeyAlgorithms = Ed25519
    return p;
  }
  throw new Error('No mutually supported auth profile');
}

// CAIP identifiers (CAIP-2 network, CAIP-10 account, CAIP-19 asset)
const NS = '[-a-z0-9]{3,8}', REF = '[-_a-zA-Z0-9]{1,32}';
const CAIP2 = new RegExp(`^${NS}:${REF}$`);
const CAIP10 = new RegExp(`^${NS}:${REF}:[-.%a-zA-Z0-9]{1,128}$`);
const CAIP19 = new RegExp(`^${NS}:${REF}/${NS}:[-.%a-zA-Z0-9]{1,128}(/[-.%a-zA-Z0-9]{1,78})?$`);
export const isCaip2 = (s) => typeof s === 'string' && CAIP2.test(s);
export const isCaip10 = (s) => typeof s === 'string' && CAIP10.test(s);
export const isCaip19 = (s) => typeof s === 'string' && CAIP19.test(s);
export function parseCaip10(s) {
  if (!isCaip10(s)) throw new Error('invalid CAIP-10 account id');
  const i = s.lastIndexOf(':');
  return { network: s.slice(0, i), address: s.slice(i + 1) };
}
export function parseCaip19(s) {
  if (!isCaip19(s)) throw new Error('invalid CAIP-19 asset id');
  const [network, asset, tokenId] = s.split('/');
  const [assetNamespace, assetReference] = asset.split(':');
  return { network, assetNamespace, assetReference, ...(tokenId ? { tokenId } : {}) };
}
export const caip10 = (network, address) => { const v = `${network}:${address}`; if (!isCaip2(network) || !isCaip10(v)) throw new Error('invalid CAIP-10 parts'); return v; };
export const keyFamilyForNetwork = (network) => network.startsWith('eip155:') ? 'ES256K' : 'EdDSA';
