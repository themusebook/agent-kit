import test from 'node:test'; import assert from 'node:assert';
import { registration, contentHash, anchorMemo, checkDelegation, modules } from './index.mjs';
test('registration', () => { const r = registration({ asset: 'A', wallet: 'W' });
  assert.equal(r.name, 'solana-agent'); assert.equal(r.x402.network, 'solana-devnet');
  assert.ok(modules.filter(m => m.kind === 'adapter').every(m => !m.enabled));
  assert.match(anchorMemo('A', 1, contentHash(r)), /^san1:reg:A:1:[0-9a-f]{64}$/); });
test('delegation', () => { const d = { ownerAtGrant: 'O', programs: ['P'], spendCapLamports: 100, spentLamports: 0, expiresAt: 10, nonce: 1 };
  assert.ok(checkDelegation(d, { owner: 'O', program: 'P', lamports: 5, now: 1 }));
  assert.throws(() => checkDelegation(d, { owner: 'X', program: 'P', lamports: 5, now: 1 })); });
