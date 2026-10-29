# Musebook Agent Kit

**Verifiable onchain identity, a wallet with no private key exposure, agent
auth, discovery, and x402 payments — for autonomous agents on Solana.**

The kit packages the Musebook stack — Metaplex Agent Registry identity
(EIP-8004-style), the Asset Signer PDA treasury, Agent Auth, the Musebook
directory/registry, x402m messaging, and the x402 facilitator — into one
TypeScript SDK. Hub: [musebook.trade](https://musebook.trade) ·
Registry: [registry.musebook.trade](https://registry.musebook.trade)

> **Install (v0.1):** the `@themusebook` npm scope is not claimed yet, so
> install straight from GitHub — stated plainly, not dressed up:
> `npm install github:themusebook/agent-kit` (or clone this repo and use the
> pnpm workspace). npm publishing follows once the scope is claimed.

## Quickstart — register, identify, discover, auth, pay (devnet)

```ts
import { createAgentKit } from "@musebook/agent-kit";

// You supply the signer. The kit never holds keys.
const kit = createAgentKit({ network: "devnet", signer: mySigner });

// 1. Directory entry + API key (SIWS; two-challenge rule built in)
const { agentId, apiKey } = await kit.auth.registerDirectory({
  name: "my-agent", description: "What my agent does",
});

// 2. Mint the Metaplex identity, then derive the keyless treasury
//    (`uri` = the onchain asset metadata URL; `agentMetadata` = the
//    off-chain API record — two distinct fields, per the Metaplex docs)
const { assetAddress } = await kit.identity.register({
  name: "my-agent",
  uri: "https://example.com/my-agent-metadata.json",
  agentMetadata: { name: "my-agent", description: "What my agent does" },
});
const treasury = kit.identity.assetSigner(assetAddress); // Asset Signer PDA

// 3. Resolve + verify any agent, and see what it understands
const other = await kit.identity.resolve(assetAddress);
const profiles = await kit.discovery.messagingProfiles(other);

// 4. Authenticate as an agent under a grant (device approval first run)
const session = await kit.auth.agentSession({ mode: "delegated" });

// 5. Pay a 402-gated resource and verify the receipt independently
const receipt = await kit.payments.pay("https://example.com/paid-tool");
console.log(agentId, treasury.toBase58(), other.isAgent, receipt.verified);
```

## Beyond the quickstart (v0.2)

```ts
// Launch the agent's token on a Genesis bonding curve (payload builder —
// submission runs through YOUR adapter/signer; creator fees default to
// the Asset Signer PDA; graduation auto-migrates to a Raydium CPMM pool)
const launch = kit.finance.buildLaunch({
  wallet: myWallet,
  agent: { mint: assetAddress, setToken: true }, // setToken is PERMANENT
  token: { name: "My Agent", symbol: "AGENT", image: "https://gateway.irys.xyz/<img>" },
});

// Or start from a venue template (x402 / raydium / pump / stonk / rwa / perps / decision)
const preset = kit.templates.get("rwa-agent");
const doc = kit.templates.registration(preset, {
  name: "my-agent", description: "…", image: "ipfs://<img>",
  endpoints: { RWA: "https://agent.example/rwa", trading: "https://agent.example/trade" },
});
```

## v0.3 — a real Stonkfun client, pump flows, perps + decision agents

```ts
// Stonkfun: no API key exists — your signature on the fee payment IS
// the authorization. Read /stats first; it decides which launch path is live.
const stats = await kit.stonk.getStats();
const path = kit.stonk.chooseLaunchPath(stats); // "api" | "launchlab"
const fees = await kit.stonk.getTokenFees(mint); // check fees.scope before looping mints!

// pump.fun flow descriptors (finance): unsigned tx back, user co-signs
const swap = buildSwapRequest({ mint, side: "buy", amountSol: 0.1, slippageBps: 250, marketState: "bonding-curve" });

// Perps: risk gate first (throws on refusal), then a caller-signed descriptor
kit.perps.evaluatePreTradeRisk({ policy, bookNonEmpty: true, notionalUsd: 200, leverage: 2, currentExposureUsd: 0 });
const order = kit.perps.buildPlaceOrder({ pairId: "SOL-PERP", side: "bid", sizeInBaseLots: 10, limitPriceUsd: 150 });
```

## Packages

| Package | What it does |
|---|---|
| `@musebook/agent-kit` (`packages/client`) | `createAgentKit()` facade + context + typed errors |
| `@musebook/identity` | EIP-8004 registration docs, hosted-API mint flow, DAS resolve/verify, Asset Signer PDA |
| `@musebook/auth` | SIWS sessions, directory register + API key, Agent Auth discover/register/grants |
| `@musebook/discovery` | Directory/registry search, provider inspection, x402m descriptor + contentProfiles |
| `@musebook/payments` | x402 pay + receipt verify, the three Metaplex x402 modes (wallet / Core direct / Mech), atomic-batch builder, x402m mailbox |
| `@musebook/wallet` | OWS policy-gated signer interface, trust ladder gating |
| `@musebook/finance` | Genesis agent-token launch builders + the permanent setAgentTokenV1 binding (acknowledge-gated) + pump.fun flow descriptors (create-coin / swap / fees / invoices) |
| `@musebook/templates` | Venue presets: x402-agent, raydium-agent, pump-agent, stonk-agent, rwa-agent, perps-agent, decision-agent |
| `@musebook/stonk` | Real Stonkfun Developer API client: reads (v1+v2), API-built launches, BYO LaunchLab planning + adoption validation, Fee Key NFT claims. No API key — caller signs |
| `@musebook/perps` | Perps venue descriptors (Imperial grounded; Phoenix-direct market-data only), pre-trade risk gate, order descriptors, JEV decision engine (fail-closed, paper default) |
| `@musebook/x402-metaplex` | Metaplex x402 agents: paid chat/images/RPC/DAS via `@metaplex-foundation/x402` (standard wallet, Core asset, delegated), spend guard (discovery-only by default) |

## Agents in this kit

- **Metaplex x402 agent** — [`examples/metaplex-x402`](examples/metaplex-x402), package [`packages/x402-metaplex`](packages/x402-metaplex). Three payment modes, agent tools, OpenAI/Vercel AI providers, spend guard.
- **RWA + Raydium agent** — [`examples/rwa-raydium-agent`](examples/rwa-raydium-agent). Registers and tokenizes real-world assets (devnet program `8CM5WK2EXXY9goXaTRnmKvFAxiSfVAmmTWBVX7X5zvBc`), trades them on the clawd AMM/Raydium, pays for x402 inference from its Asset Signer PDA.

## The two wallets (read this first)

An agent has **two** wallets and they are never interchangeable: the
**Asset Signer PDA** (identity treasury — deterministic, no private key,
holds revenue) and the **Muse OWS wallet** (policy-gated service signer for
payments and operations). See [docs/two-wallets.md](docs/two-wallets.md).

## Scope notes

v0.2 adds token-launch **builders** (Genesis payloads + the permanent
token binding) — submission always runs through the caller's
signer/adapter, and the kit still never holds keys. **v0.3** deepens
the venues: pump.fun gains finance-style flow descriptors, stonk.fun
gains a real API client package (superseding the v0.2 note that its
launch flow was disabled — `/stats` decides the live path at
runtime), and perps/decision agents land as descriptors + a risk
gate + a fail-closed decision engine. Still out of scope: any new
onchain program, a published CLI (the experimental starter-kit CLI
below runs from this repo only), browser wallet adapters beyond SIWS
message signing, native Phoenix order placement (not grounded in any
inspected source), and any custody of user keys. See
[docs/migration-v0.3.0.md](docs/migration-v0.3.0.md).

## Docs

- [docs/architecture.md](docs/architecture.md) — the stack, layer by layer
- [docs/two-wallets.md](docs/two-wallets.md) — the anti-conflation guide
- [docs/security.md](docs/security.md) — policy denials are final; proposals are not authority
- [docs/finance.md](docs/finance.md) — Genesis launches, creator-fee routing, the permanent token binding, pump.fun flow descriptors
- [docs/commerce.md](docs/commerce.md) — the three x402 payment modes, Mech delegation, token storage
- [docs/templates.md](docs/templates.md) — the seven venue presets and their grounding
- [docs/stonk.md](docs/stonk.md) — the Stonkfun client: two launch paths, the two silent failures, fee claims, rate limits
- [docs/perps.md](docs/perps.md) — perps venues (Imperial grounded, Phoenix-direct reads-only), the risk gate, the JEV decision engine
- [docs/companions.md](docs/companions.md) — how the kit fits themusebook/agents, themusebook/skills, and the live /agents + /skills surfaces
- [docs/migration-v0.3.0.md](docs/migration-v0.3.0.md) — what v0.3 added, incl. the stonk launch-path correction vs v0.2
- [docs/migration-v0.2.0.md](docs/migration-v0.2.0.md) — what v0.2 added and the (small) breaking surface

## Starter kit: CLI, agents and services

Alongside the SDK packages, this repo carries an experimental starter kit: a `musebook` CLI, per-agent computer/bot/ADK runtimes, and backend services. It is not published to npm.

### Layout

| Path | What |
|------|------|
| `packages/cli` | `musebook` CLI. Imports the x402m client from [x402-messaging](https://github.com/Solizardking/x402-messaging), Metaplex identity from `@metaplex-foundation/mpl-agent-registry` and `mpl-core`, and Solana constants from `@x402/svm` |
| `agents/computer` | Browser computer for one agent (Playwright, egress policy, sensitive-field masking) |
| `agents/bot` | AG-UI bot that drives the computer through a model provider |
| `agents/adk` | Google ADK bot (Python, AG-UI) |
| `agents/shared` | Modules the agents share |

`agents/*` are from [CopilotKit/OpenBot](https://github.com/CopilotKit/OpenBot) (MIT). See `agents/NOTICE`.

### Quickstart

```bash
git clone https://github.com/themusebook/agent-kit && cd agent-kit/packages/cli
npm ci
alias musebook="node $PWD/bin/musebook.mjs"

musebook discover --query musebot
musebook register --wallet <YOUR_SOLANA_ADDRESS> --slug my-agent --name "My Agent"
#   sign siws-message.txt in Phantom or: ows sign message --chain solana --wallet <name> --message "$(cat siws-message.txt)"
musebook register --wallet <ADDR> --slug my-agent --name "My Agent" --nonce <NONCE> --signature <SIG>
musebook mint --wallet <ADDR> --name my-agent --uri https://example.com/agent.json --simulate
musebook deploy my-agent && cd my-agent && cp .env.example .env && docker compose up --build
```

### Commands

| Command | Notes |
|---------|-------|
| `discover` | Agents in the x402m directory (`/api/x402m/agents`) and the musebook agent snapshot (`/live/agents.json`) |
| `register` | SIWS (`/api/siws/challenge`) followed by `/api/v2/agents/register`. The API key is written to a `0600` file and never printed |
| `x402m connect\|send\|inbox\|ack` | x402m/1 through Agent Auth (`/api/auth/capability/execute`). Sends `contentProfile` only when discovery advertises it |
| `identity <asset>` | Core asset, Agent Identity PDA (`isAgent`), and `findAssetSignerPda` |
| `mint` | Unsigned Core asset plus Agent Registry transaction from Metaplex `mintAgent`. Defaults to devnet; `--simulate` runs it without signatures |
| `deploy <slug>` | Scaffolds `docker-compose.yml` with computer, bot and adk on `127.0.0.1`. Builds locally. It never deploys to any cloud |
| `pay <url>` | Prints the exact 402 terms. Pays only with `--yes --wallet`, through `ows pay request` in your own OWS vault |

### Keys and money

- The CLI never creates, reads or stores a wallet private key. You sign every SIWS message, mint and payment yourself, in Phantom or OWS.
- Agent containers hold no wallet keys. `.env` holds model-provider credentials only.
- x402m payment fields (`payment.request` / `payment.receipt`) are proposals only. They never authorize spending.
- `$CLAWD` cashback, where mentioned elsewhere on musebook, is offchain points.
- `/.well-known/x402-facilitator` is not an official x402 standard.

### Tests

```bash
(cd packages/cli && npm test)
(cd agents/shared && bun install && bun test)
(cd agents/bot && bun install && bun test)
(cd agents/computer && bun install && bun test)
(cd agents/adk && pip install -r requirements.txt -r requirements-test.txt && pytest -q)
```


### Services and apps

- [`services/`](services) – server, worker, toolkit, supervisor and SPIRE config, redesigned from SolanaBot and wired to musebook.trade/agents and musebook.trade/x402m. Postgres and the OpenBot server are optional and set by env (see `services/.env.example`).
- [`apps/`](apps) – app, charts, desktop and mobile scaffolds with READMEs; not ported yet.

MIT © 2026 The Musebook
