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
import { createAgentKit } from "@themusebook/agent-kit";

// You supply the signer. The kit never holds keys.
const kit = createAgentKit({ network: "devnet", signer: mySigner });

// 1. Directory entry + API key (SIWS; two-challenge rule built in)
const { agentId, apiKey } = await kit.auth.registerDirectory({
  name: "my-agent", description: "What my agent does",
});

// 2. Mint the Metaplex identity, then derive the keyless treasury
const { assetAddress } = await kit.identity.register({
  name: "my-agent", metadataUri: "ipfs://<pinned-registration-doc>",
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

## Packages

| Package | What it does |
|---|---|
| `@themusebook/agent-kit` (`packages/client`) | `createAgentKit()` facade + context + typed errors |
| `@themusebook/agent-kit-identity` | EIP-8004 registration docs, hosted-API mint flow, DAS resolve/verify, Asset Signer PDA |
| `@themusebook/agent-kit-auth` | SIWS sessions, directory register + API key, Agent Auth discover/register/grants |
| `@themusebook/agent-kit-discovery` | Directory/registry search, provider inspection, x402m descriptor + contentProfiles |
| `@themusebook/agent-kit-payments` | x402 pay + receipt verify, atomic-batch builder, x402m mailbox |
| `@themusebook/agent-kit-wallet` | OWS policy-gated signer interface, trust ladder gating |

## The two wallets (read this first)

An agent has **two** wallets and they are never interchangeable: the
**Asset Signer PDA** (identity treasury — deterministic, no private key,
holds revenue) and the **Muse OWS wallet** (policy-gated service signer for
payments and operations). See [docs/two-wallets.md](docs/two-wallets.md).

## Not in v0.1

Token launch (read/verify of the `agent_token` binding only), any new
onchain program, a CLI, browser wallet adapters beyond SIWS message
signing, and any custody of user keys. See the release notes.

## Docs

- [docs/architecture.md](docs/architecture.md) — the stack, layer by layer
- [docs/two-wallets.md](docs/two-wallets.md) — the anti-conflation guide
- [docs/security.md](docs/security.md) — policy denials are final; proposals are not authority

MIT © 2026 The Musebook
