import { createPrivateKey } from 'node:crypto';
import { signAgentJwt, algorithmForJwk, assertMessagingCapabilities, assertNotPaymentAuthorization } from './auth.mjs';
import { readFile, stat } from 'node:fs/promises';
import { validateX402mInput, PROVIDER_ALGORITHMS } from './schema.mjs';
import { advertisedProfiles, checkContentProfile, UnsupportedProfileError } from './profiles.mjs';
export const PROVIDER = 'https://musebook.trade';
export class X402mClient {
  constructor({ agentId, privateKey, provider = PROVIDER, fetchImpl = fetch }) {
    const url = new URL(provider);
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('HTTPS required');
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('provider must be an origin');
    this.provider = url.origin; this.agentId = agentId; this.key = privateKey; this.fetch = fetchImpl;
  }
  async read(path) {
    const r = await this.fetch(this.provider + path, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`Discovery failed: HTTP ${r.status}`);
    return r.json();
  }
  async execute(capability, args = {}) {
    if (!this.agentId || !this.key) throw new Error('Agent enrollment required; set X402M_AGENT_ID and X402M_KEY_FILE');
    const url = this.provider + '/api/auth/capability/execute';
    const body = JSON.stringify({ capability, arguments: args });
    assertMessagingCapabilities([capability]);
    assertNotPaymentAuthorization({ body: { arguments: args } });
    if (this.provider === PROVIDER) validateX402mInput(capability, args);
    if (capability === 'x402m.send' && args.contentProfile !== undefined) {
      // Never send contentProfile unless this service advertises it in discovery.
      const err = checkContentProfile(args.contentProfile, advertisedProfiles(await this.read('/api/x402m/discovery')));
      if (err) throw new UnsupportedProfileError(err);
    }
    const token = signAgentJwt({ privateKey: this.key, agentId: this.agentId, url, body, capability });
    const r = await this.fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body });
    const result = await r.json();
    if (!r.ok) throw new Error(`Capability failed: HTTP ${r.status}: ${String(result.message || result.error || 'request rejected').slice(0, 200)}`);
    return result.data ?? result;
  }
}
export async function clientFromEnv(env = process.env) {
  let privateKey;
  if (env.X402M_KEY_FILE) {
    const info = await stat(env.X402M_KEY_FILE);
    if ((info.mode & 0o077) !== 0) throw new Error('X402M_KEY_FILE must be private (chmod 600)');
    const jwk = JSON.parse(await readFile(env.X402M_KEY_FILE, 'utf8'));
    if (!jwk.d) throw new Error('Expected private agent JWK, not a wallet key');
    const alg = algorithmForJwk(jwk); // Ed25519 (EdDSA) or secp256k1 (ES256K)
    if ((env.X402M_PROVIDER || PROVIDER) === PROVIDER && !PROVIDER_ALGORITHMS.includes(alg)) throw new Error('musebook.trade accepts Ed25519 agent keys only');
    privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
  }
  return new X402mClient({ agentId: env.X402M_AGENT_ID, privateKey, provider: env.X402M_PROVIDER || PROVIDER });
}
