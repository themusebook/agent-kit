# Security Policy

Please do not file a public issue for a potential vulnerability. Email **toly@mail.grokbot.com**
with details and steps to reproduce.

## Safety defaults

- Solana **devnet** by default. Mainnet is refused unless `MUSEBOOK_ENABLE_MAINNET=true` is set.
- The Solana Agent Network provider never holds keys and never signs or sends transactions; the
  owner's wallet signs on https://join.musebook.trade/network/join.
- No secrets in code. Analytics are disabled (no telemetry is sent anywhere).

## Prompt Injection

Prompt injection is inherent to giving an AI agent a wallet. See [Managing Risk](README.md#managing-risk).

Built on Solana. Not affiliated with or endorsed by the Solana Foundation.
