import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { MusebookA2A, connect, clientFromIdentity } from '../../a2a-network/src/index.mjs';

export const a2aDir = (handle, env = process.env) => join(env.MUSEBOOK_HOME ?? join(homedir(), '.config', 'musebook'), 'a2a', handle);

/** Writes a file with 0600 permissions and never overwrites an existing one ('wx'). */
export const saver = (dir) => async (name, data) => {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, name), JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
};

export async function loadClient(handle, env = process.env, fetchImpl) {
  if (!handle) throw new Error('pass --as <handle> (or set MUSEBOOK_A2A_HANDLE); run `musebook connect` first');
  const dir = a2aDir(handle, env);
  const read = async (n) => JSON.parse(await readFile(join(dir, n), 'utf8'));
  return clientFromIdentity({ identity: await read('identity.json'), agentJwk: await read('agent.private.jwk'), fetchImpl });
}

/** The owner signs the SIWS message in their own wallet; we only read the signature back. */
export async function promptSignature(message, { input = process.stdin, output = process.stderr } = {}) {
  output.write(`\nSign this message in YOUR wallet (Phantom signMessage, or: ows sign message --chain solana --wallet <name> --message "...").\n---\n${message}\n---\n`);
  const rl = createInterface({ input, output });
  try { return (await rl.question('Paste the signature: ')).trim(); } finally { rl.close(); }
}

export async function runConnect(f, env = process.env, deps = {}) {
  if (!f.wallet || !f.handle) throw new Error('musebook connect --wallet <owner pubkey> --handle <handle> [--name N] [--description D]');
  const dir = a2aDir(f.handle, env);
  return connect({ wallet: f.wallet, handle: f.handle, name: f.name ?? f.handle, description: f.description ?? '', signMessage: deps.signMessage ?? ((m) => promptSignature(m)), save: saver(dir), fetchImpl: deps.fetchImpl }).then((r) => ({ ...r, savedTo: dir }));
}

export async function runA2A([sub, ...a], f, env = process.env, deps = {}) {
  const pub = new MusebookA2A({ fetchImpl: deps.fetchImpl });
  const as = f.as ?? env.MUSEBOOK_A2A_HANDLE;
  switch (sub) {
    case 'list': return pub.listAll();
    case 'card': return a[0] ? pub.card(a[0]) : pub.rootCard();
    case 'send': {
      if (!a[0] || !a[1]) throw new Error('musebook a2a send <handle> <text> --as <your handle>');
      return (await loadClient(as, env, deps.fetchImpl)).send(a[0], a.slice(1).join(' '));
    }
    case 'tasks': return a[0] ? (await loadClient(as, env, deps.fetchImpl)).getTask(a[0]) : (await loadClient(as, env, deps.fetchImpl)).listTasks();
    case 'connect': return runConnect(f, env, deps);
    default: throw new Error('musebook a2a list | card [handle] | send <handle> <text> --as H | tasks [id] --as H | connect');
  }
}
