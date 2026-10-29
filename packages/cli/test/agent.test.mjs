import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionedTransaction } from '@solana/web3.js';
import { agentUmi, searchParams, searchAgents, agentWallet, delegation, executiveRegister, delegate, revoke, cleanupApproval, readAgent, OPERATIONAL_AUTHORITY, REVOKE_SCOPE } from '../src/agent.mjs';

const ASSET = '84jw9dw7hMRJXFvzJXrBzVQpmVWaGUtYT7R6QhNU9qt3', SIGNER = '6ttUwc5VVmHeVKTddB6XM5vQgBMfw62DThuoiVEufVZq';
const OWNER = 'CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU', EXEC = 'AgZH58XPLZnxpS1cxZL22vRoDio53Y6m6gLQtpTnb3QK';
const BH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N', TOOLS = 'TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S';
const base = { rpc: 'http://127.0.0.1:1', blockhash: BH };
const res = (body, status = 200) => async () => new Response(JSON.stringify(body), { status });
const unsignedBy = (b64, payer) => { const tx = VersionedTransaction.deserialize(Buffer.from(b64, 'base64')); assert.equal(tx.message.staticAccountKeys[0].toBase58(), payer); assert.ok(tx.signatures.every((s) => s.every((b) => b === 0))); return tx.message.staticAccountKeys.map(String); };

test('agent search: camelCase params, docs fixture, SDK PDA agrees with DAS asset_signer', async () => {
  assert.deepEqual(searchParams({}), { interface: 'MplCoreAsset', limit: 100, isAgent: true });
  assert.deepEqual(searchParams({ agentToken: 'M', limit: 1 }), { interface: 'MplCoreAsset', limit: 1, agentToken: 'M' });
  let sent;
  const rows = await searchAgents({ das: 'https://das.example' }, { fetchImpl: async (u, i) => { sent = JSON.parse(i.body); return res({ result: { items: [{ interface: 'MplCoreAsset', id: '1RUC5FMQherGNoLF9wDBxa1oznbq1mTieWLZ8gU8S31', is_agent: true, asset_signer: 'DwgDrVVwcuXGU2MjHcZEcNtG2cGF6cLXCS35gPiUsU6p' }] } })(); } });
  assert.equal(sent.method, 'searchAssets');
  assert.equal(rows[0].signerAgrees, true);
});

test('agent wallet: Asset Signer from docs example + balance + warning', async () => {
  const umi = agentUmi(base.rpc); umi.rpc.getBalance = async () => ({ basisPoints: 1000000n });
  const w = await agentWallet(ASSET, base, { umi });
  assert.equal(w.assetSigner, SIGNER); assert.equal(w.lamports, '1000000'); assert.match(w.warning, /not the asset address/);
});

test('agent read: unregistered → registered:false, no throw', async () => {
  const umi = agentUmi(base.rpc); umi.rpc.getAccount = async (k) => ({ exists: false, publicKey: k });
  const r = await readAgent(ASSET, base, { umi });
  assert.equal(r.registered, false); assert.equal(r.plugin, null);
});

test('agent delegation: checks the record PDA', async () => {
  const umi = agentUmi(base.rpc); let asked; umi.rpc.getAccount = async (k) => { asked = String(k); return { exists: true }; };
  const d = await delegation({ ...base, asset: ASSET, executive: EXEC }, { umi });
  assert.equal(d.delegated, true); assert.equal(asked, d.executionDelegateRecord);
});

test('agent executive register / delegate / revoke / cleanup-approval print unsigned txs', async () => {
  const r = await executiveRegister({ ...base, wallet: EXEC });
  assert.ok(unsignedBy(r.base64, EXEC).includes(TOOLS)); assert.equal(r.signed, false);
  const d = await delegate({ ...base, wallet: OWNER, asset: ASSET, executive: EXEC });
  assert.ok(unsignedBy(d.base64, OWNER).includes(d.accounts.executionDelegateRecord)); assert.ok(d.warnings.includes(OPERATIONAL_AUTHORITY));
  const v = await revoke({ ...base, wallet: EXEC, asset: ASSET, executive: EXEC, destination: OWNER });
  assert.ok(unsignedBy(v.base64, EXEC).includes(OWNER)); assert.ok(v.warnings.includes(REVOKE_SCOPE));
  const c = await cleanupApproval({ ...base, wallet: OWNER, asset: ASSET, mint: 'So11111111111111111111111111111111111111112', noCollection: true });
  const keys = unsignedBy(c.base64, OWNER); assert.ok(keys.includes(SIGNER) && keys.includes('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'));
  await assert.rejects(async () => delegate({ ...base, asset: ASSET, executive: EXEC }), /--wallet is required/);
});
