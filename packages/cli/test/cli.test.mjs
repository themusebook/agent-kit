import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { USDC_MAINNET_ADDRESS, SOLANA_MAINNET_CAIP2 } from '@x402/svm';
import { MPL_AGENT_IDENTITY_PROGRAM_ID } from '@metaplex-foundation/mpl-agent-registry';
import { parseArgs } from '../src/cli.mjs';
import { challenge, register, signatureToBase64 } from '../src/register.mjs';
import { parse402, payWithOws } from '../src/pay.mjs';
import { prepareMint, registration, umiFor } from '../src/identity.mjs';
import { scaffold, compose, TEMPLATE_URL } from '../src/deploy.mjs';

const WALLET = '3NHMeZPXXZVgArbgE6hJU3fq72fR9UsgbmH9zFvQiGC1';
const fakeFetch = (handler) => async (url, init) => { const [status, body] = await handler(url, init); return new Response(JSON.stringify(body), { status }); };

test('parseArgs camel-cases flags and keeps booleans', () => {
  assert.deepEqual(parseArgs(['mint', '--content-profile', 'a/v1', '--simulate']), { pos: ['mint'], flags: { contentProfile: 'a/v1', simulate: true } });
});

test('register: challenge then submit with hex signature converted to base64', async () => {
  const sig = 'ab'.repeat(64), calls = [];
  const fetchImpl = fakeFetch((url, init) => { calls.push([new URL(url).pathname, JSON.parse(init.body)]); return url.endsWith('challenge') ? [200, { ok: true, nonce: 'n1', message: 'm' }] : [200, { api_key: 'k' }]; });
  assert.deepEqual(await challenge(WALLET, { fetchImpl }), { nonce: 'n1', message: 'm' });
  await register({ wallet: WALLET, nonce: 'n1', signature: sig, slug: 'my-bot', name: 'My Bot' }, { fetchImpl });
  assert.deepEqual(calls[1], ['/api/v2/agents/register', { wallet: WALLET, nonce: 'n1', signature: Buffer.from(sig, 'hex').toString('base64'), slug: 'my-bot', name: 'My Bot' }]);
});

test('register rejects bad slug, wallet and short signatures before any request', async () => {
  const fetchImpl = () => assert.fail('no request expected');
  await assert.rejects(register({ wallet: WALLET, nonce: 'n', signature: 'ab'.repeat(64), slug: 'Bad_Slug', name: 'x' }, { fetchImpl }), /slug/);
  await assert.rejects(challenge('0xnotsolana', { fetchImpl }), /base58/);
  assert.throws(() => signatureToBase64('abcd'), /64-byte/);
});

test('parse402 reads v1 body terms and labels USDC from @x402/svm constants', () => {
  const t = parse402(402, new Headers(), { x402Version: 1, accepts: [{ scheme: 'exact', network: 'solana', asset: USDC_MAINNET_ADDRESS, maxAmountRequired: '1000', payTo: WALLET }] });
  assert.equal(t.accepts[0].network, SOLANA_MAINNET_CAIP2);
  assert.equal(t.accepts[0].assetLabel, 'USDC');
  assert.equal(t.accepts[0].amount, '1000');
  assert.equal(parse402(200, new Headers(), {}), null);
});

test('parse402 prefers the v2 PAYMENT-REQUIRED header', () => {
  const pr = { x402Version: 2, resource: { url: 'https://x' }, accepts: [{ scheme: 'exact', network: SOLANA_MAINNET_CAIP2, asset: USDC_MAINNET_ADDRESS, amount: '5', payTo: WALLET }] };
  const t = parse402(402, new Headers({ 'payment-required': Buffer.from(JSON.stringify(pr)).toString('base64') }), null);
  assert.equal(t.x402Version, 2);
  assert.equal(t.resource, 'https://x');
});

test('payWithOws needs a wallet and delegates signing to ows', () => {
  assert.throws(() => payWithOws('https://x'), /--wallet/);
  let argv; payWithOws('https://x', 'main', (cmd, a) => { argv = [cmd, ...a]; return { status: 0 }; });
  assert.deepEqual(argv, ['ows', 'pay', 'request', 'https://x', '--wallet', 'main']);
});

test('prepareMint defaults to devnet, never signs, and returns serialized bytes', async () => {
  const umi = umiFor('solana-devnet');
  let input;
  const fakeTx = { message: {}, serializedMessage: new Uint8Array([1, 2, 3]), signatures: [] };
  umi.transactions = { serialize: () => new Uint8Array([9, 9]) };
  const r = await prepareMint({ wallet: WALLET, name: 'a', uri: 'https://e/x.json' }, { umi, mint: async (_u, _c, i) => { input = i; return { transaction: fakeTx, assetAddress: WALLET }; } });
  assert.equal(input.network, 'solana-devnet');
  assert.equal(r.signed, false);
  assert.equal(r.hex, '0909');
  await assert.rejects(prepareMint({ wallet: WALLET, name: 'a', uri: 'http://insecure' }, { umi, mint: () => assert.fail() }), /https/);
  assert.equal(MPL_AGENT_IDENTITY_PROGRAM_ID, '1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p');
});

test('registration advertises musebook x402m discovery', () => {
  assert.ok(registration({ name: 'a', x402mHandle: 'h' }).services.some((s) => s.endpoint === 'https://musebook.trade/api/x402m/discovery'));
});

test('deploy scaffolds computer, bot and adk bound to localhost with no keys', async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'mk-')), 'bot');
  const fetchImpl = fakeFetch(() => [200, { id: 'musebot', shareUrl: 'https://x.ai/bot/old', skill: 'https://musebook.trade/SKILL.md' }]);
  await scaffold({ slug: 'my-bot', dir, fetchImpl });
  const yml = await readFile(join(dir, 'docker-compose.yml'), 'utf8');
  for (const s of ['computer:', 'bot:', 'adk:', 'dockerfile: computer/Dockerfile', '127.0.0.1:4100', '127.0.0.1:4208']) assert.ok(yml.includes(s), s);
  assert.equal(JSON.parse(await readFile(join(dir, 'agent.json'), 'utf8')).template.shareUrl, TEMPLATE_URL);
  assert.match(await readFile(join(dir, '.env.example'), 'utf8'), /OPENAI_API_KEY=\n/);
  assert.equal(JSON.parse(await readFile(join(dir, 'agent.json'), 'utf8')).wallet.keys, 'none in containers');
  await assert.rejects(scaffold({ slug: 'my-bot', dir, fetchImpl }), /exists/);
  assert.ok(!compose({ slug: 'a', kitRoot: '.', withResponder: false }).includes('x402m-responder'));
});
