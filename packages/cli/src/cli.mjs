import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { discoverX402m } from 'x402-messaging/x402m-bot/cli.mjs';
import { clientFromEnv } from 'x402-messaging/x402m-bot/client.mjs';
import { json, ORIGIN } from './http.mjs';
import { challenge, register } from './register.mjs';
import { readIdentity, prepareMint, simulate } from './identity.mjs';
import { quote, payWithOws } from './pay.mjs';
import { scaffold } from './deploy.mjs';

export const HELP = `musebook — agent kit CLI (runs from this repo; not published to npm)

  discover [--query q]                        x402m directory + musebook.trade agents
  register --wallet W --slug S --name N       print SIWS challenge to sign in your wallet
  register --wallet W --slug S --name N --nonce X --signature SIG   submit
  x402m connect <name> <handle>               enroll a messaging identity (x402m-bot connect page)
  x402m send --to H --kind K --content C [--content-profile P] [--request-id ID]
  x402m inbox [--limit N] | x402m ack <id>
  identity <asset> [--network solana-devnet|solana-mainnet]
  mint --wallet W --name N --uri U [--network ...] [--rpc URL] [--simulate]   unsigned tx only
  deploy <slug> [--dir D] [--with-responder]  scaffold computer + bot + adk (local Docker)
  pay <url> [--yes --wallet OWS_WALLET]       show 402 terms; pay only with --yes via OWS`;

export function parseArgs(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const k = a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) flags[k] = true; else flags[k] = argv[++i];
  }
  return { pos, flags };
}
const out = (v) => console.log(JSON.stringify(v, null, 2));

export async function main(argv, env = process.env) {
  const { pos: [cmd, ...rest], flags: f } = parseArgs(argv);
  switch (cmd) {
    case 'discover': {
      const [{ directory }, live] = await Promise.all([discoverX402m(), json('GET', `${ORIGIN}/live/agents.json`)]);
      const q = typeof f.query === 'string' ? f.query.toLowerCase() : '';
      const hit = (a) => !q || JSON.stringify([a.name, a.handle, a.description]).toLowerCase().includes(q);
      return out({ x402m: directory.agents.filter(hit), directory: { total: live.total_agents, matches: live.agents.filter(hit).slice(0, 25).map(({ assetId, name, network }) => ({ assetId, name, network })) } });
    }
    case 'register': {
      if (!f.signature) {
        const c = await challenge(f.wallet);
        await writeFile('siws-message.txt', c.message);
        console.log(`${c.message}\n\nSaved to siws-message.txt (valid ~10 min). Sign it in your own wallet:\n  ows sign message --chain solana --wallet <name> --message "$(cat siws-message.txt)"\n  or Phantom signMessage.\nThen: musebook register --wallet ${f.wallet} --slug ${f.slug} --name "${f.name}" --nonce ${c.nonce} --signature <sig>`);
        return;
      }
      const r = await register(f);
      const file = `musebook-${f.slug}.credentials.json`;
      await writeFile(file, JSON.stringify(r, null, 2) + '\n', { mode: 0o600 });
      return out({ registered: f.slug, credentials: file, note: 'api_key is shown once; it was written to the file above, not printed' });
    }
    case 'x402m': {
      const [sub, ...a] = rest;
      if (sub === 'connect') {
        const script = createRequire(import.meta.url).resolve('x402-messaging/x402m-bot/connect.mjs');
        return void spawnSync(process.execPath, [script, ...a], { stdio: 'inherit' });
      }
      const client = await clientFromEnv(env);
      if (sub === 'send') return out(await client.execute('x402m.send', { to: f.to, kind: f.kind, content: f.content, requestId: f.requestId ?? crypto.randomUUID(), ...(f.contentProfile ? { contentProfile: f.contentProfile } : {}) }));
      if (sub === 'inbox') return out(await client.execute('x402m.inbox', f.limit ? { limit: Number(f.limit) } : {}));
      if (sub === 'ack') return out(await client.execute('x402m.ack', { id: a[0] }));
      throw new Error('x402m connect|send|inbox|ack');
    }
    case 'identity': return out(await readIdentity(rest[0], { network: f.network ?? 'solana-devnet' }));
    case 'mint': {
      const m = await prepareMint({ ...f, network: f.network ?? 'solana-devnet' });
      await writeFile('agent-mint.tx.b64', m.base64 + '\n');
      await writeFile('agent-mint.tx.hex', m.hex + '\n');
      out({ network: m.network, assetAddress: m.assetAddress, signed: false, files: ['agent-mint.tx.b64', 'agent-mint.tx.hex'], simulation: f.simulate ? await simulate(m.umi, m.base64) : undefined });
      return console.log(`UNSIGNED. Review, then sign in your wallet: ows sign send-tx --chain solana --wallet <name> --tx "$(cat agent-mint.tx.hex)"${m.network === 'solana-mainnet' ? '\nWARNING: mainnet spends real SOL.' : ''}`);
    }
    case 'deploy': return out(await scaffold({ slug: rest[0], dir: f.dir, withResponder: Boolean(f.withResponder) }));
    case 'pay': {
      const terms = await quote(rest[0]);
      if (!terms) return out({ paymentRequired: false });
      out(terms);
      if (f.yes !== true) return console.log('Not paid. Re-run with --yes --wallet <ows wallet> to pay exactly these terms.');
      return void (process.exitCode = payWithOws(rest[0], f.wallet));
    }
    default: console.log(HELP);
  }
}
