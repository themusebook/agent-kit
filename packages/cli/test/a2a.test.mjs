import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runA2A, runConnect, a2aDir, saver } from '../src/a2a.mjs';
import { HELP } from '../src/cli.mjs';

const WALLET = '3NHMeZPXXZVgArbgE6hJU3fq72fR9UsgbmH9zFvQiGC1';
const routes = {
  'POST /api/siws/challenge': { message: 'sign me', nonce: 'N' },
  'POST /api/siws/verify': { session: 'S' },
  'POST /api/auth/host/create': { hostId: 'H' },
  'POST /api/auth/agent/register': { agent_id: 'AG', approval: { user_code: 'X' } },
  'POST /api/auth/agent/approve-capability': { ok: true },
  'POST /api/auth/capability/execute': { data: {} },
  'POST /api/auth/capability/a2a': { result: { tasks: [] } },
  'GET /api/x402m/agents': { agents: [{ agent_id: 'A', handle: 'muse-peer' }] },
  'GET /a2a/agents': { ok: true, agents: [{ handle: 'clawd' }] },
};
const fetchImpl = async (url, init = {}) => {
  const b = routes[`${init.method ?? 'GET'} ${new URL(url).pathname}`];
  return new Response(JSON.stringify(b ?? { error: 'nf' }), { status: b ? 200 : 404 });
};

test('HELP documents connect and a2a commands', () => {
  for (const c of ['connect --wallet', 'a2a list', 'a2a card', 'a2a send', 'a2a tasks']) assert.ok(HELP.includes(c), c);
});

test('a2a list merges both rosters', async () => {
  const r = await runA2A(['list'], {}, {}, { fetchImpl });
  assert.deepEqual(r.map((a) => a.handle).sort(), ['clawd', 'muse-peer']);
});

test('connect stores keys 0600 under MUSEBOOK_HOME, refuses to overwrite, then a2a tasks works', async () => {
  const env = { MUSEBOOK_HOME: await mkdtemp(join(tmpdir(), 'mb-')) };
  const r = await runConnect({ wallet: WALLET, handle: 'my-agent' }, env, { fetchImpl, signMessage: () => 'SIG' });
  assert.equal(r.agentId, 'AG');
  const dir = a2aDir('my-agent', env);
  assert.deepEqual((await readdir(dir)).sort(), ['agent.private.jwk', 'host.private.jwk', 'identity.json']);
  assert.equal((await stat(join(dir, 'agent.private.jwk'))).mode & 0o777, 0o600);
  await assert.rejects(runConnect({ wallet: WALLET, handle: 'my-agent' }, env, { fetchImpl, signMessage: () => 'SIG' }), /EEXIST/);
  assert.deepEqual(await runA2A(['tasks'], { as: 'my-agent' }, env, { fetchImpl }), { tasks: [] });
});

test('send without a connected identity explains what to do', async () => {
  await assert.rejects(runA2A(['send', 'muse-peer', 'hi'], {}, {}, { fetchImpl }), /musebook connect/);
  await assert.rejects(runConnect({}, {}, {}), /--wallet/);
});

test('saver never overwrites', async () => {
  const s = saver(await mkdtemp(join(tmpdir(), 'mb-')));
  await s('a.json', {});
  await assert.rejects(s('a.json', {}), /EEXIST/);
});
