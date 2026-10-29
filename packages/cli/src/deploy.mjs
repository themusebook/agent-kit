// Scaffolds an agent with its own computer, bot and ADK containers. Local Docker only; nothing is pushed or deployed.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, ORIGIN } from './http.mjs';
import { SLUG } from './register.mjs';
export const TEMPLATE_URL = 'https://x.ai/bot/REFgpQ-Emk9iKSarRm6Kj';
const KIT_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export function compose({ slug, kitRoot, withResponder }) {
  const svc = (name, port, env) => `  ${name}:\n    build: { context: ${kitRoot}/agents, dockerfile: ${name}/Dockerfile }\n    image: musebook-${slug}-${name}:local\n    env_file: .env\n    environment: { AGENT_SLUG: ${slug}${env} }\n    ports: ["127.0.0.1:${port}:${port}"]\n`;
  return `name: musebook-${slug}\nservices:\n${svc('computer', 4100, '')}${svc('bot', 4200, '')}${svc('adk', 4208, '')}`
    + (withResponder ? `  x402m-responder:\n    build: { context: "https://github.com/Solizardking/x402-messaging.git#ca122da", dockerfile: x402m-bot/hosted/Dockerfile }\n    env_file: .env\n    volumes: ["./x402m:/data:ro"]\n` : '');
}
export async function scaffold({ slug, dir, withResponder = false, fetchImpl }) {
  if (!SLUG.test(slug ?? '')) throw new Error('slug must be 2-32 lowercase letters, digits or hyphens');
  const out = resolve(dir ?? slug);
  if (await access(out).then(() => true, () => false)) throw new Error(`${out} already exists`);
  const template = await json('GET', `${ORIGIN}/.well-known/musebot.json`, { fetchImpl });
  await mkdir(out, { recursive: true });
  const agent = { slug, template: { id: template.id, shareUrl: TEMPLATE_URL, liveShareUrl: template.shareUrl, skill: template.skill }, musebook: { origin: ORIGIN, x402m: `${ORIGIN}/api/x402m/discovery`, directory: `${ORIGIN}/agents` }, wallet: { keys: 'none in containers', spend: 'owner signs each mint or payment via `musebook mint` / `musebook pay --yes`' } };
  await writeFile(join(out, 'agent.json'), JSON.stringify(agent, null, 2) + '\n');
  await writeFile(join(out, 'docker-compose.yml'), compose({ slug, kitRoot: relative(out, KIT_ROOT) || '.', withResponder }));
  await writeFile(join(out, '.env.example'), '# Model provider for bot/adk. Never put wallet keys or seed phrases here.\nOPENAI_API_KEY=\nBOT_MODEL=\nCOMPUTER_TOKEN=\nX402M_AGENT_ID=\nX402M_KEY_FILE=/data/agent.jwk\n');
  await writeFile(join(out, '.gitignore'), '.env\nx402m/\n');
  return { dir: out, files: ['agent.json', 'docker-compose.yml', '.env.example', '.gitignore'] };
}
