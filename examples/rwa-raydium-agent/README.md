# RWA + Raydium agent

A Metaplex agent that owns, tokenizes and trades real-world assets, and pays for its own inference via x402.

| Piece | Where |
|---|---|
| On-chain program `rwa_tokenization` (devnet `8CM5WK2EXXY9goXaTRnmKvFAxiSfVAmmTWBVX7X5zvBc`) | [Solizardking/solana-rwa-agents](https://github.com/Solizardking/solana-rwa-agents) `devnet-deploy` |
| Register/tokenize builders, RWA reads, AMM/Raydium trading, copilot `get_rwa_asset` | [Solizardking/clawd-pump-hybrid](https://github.com/Solizardking/clawd-pump-hybrid) `feat/rwa-agents` |
| Paying for inference / RPC from the agent's Asset Signer PDA | `@musebook/x402-metaplex` (`rwaAgentX402Tools`) |

Run the clawd backend locally, then:
```bash
CLAWD_API=http://localhost:8787 OWNER_WALLET=<you> AGENT_ASSET=<core asset> pnpm --filter @themusebook/example-rwa-raydium-agent start
```
Nothing is signed or sent; transactions come back unsigned for your wallet. Agent mode (Asset Signer as
RWA owner via Core `execute`) is not yet simulated on devnet.
