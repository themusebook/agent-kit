# Musebook Agent Network Action Provider

Connects an agent to the **Solana Agent Network** (devnet) using the live registry at
https://join.musebook.trade (manifest: `/.well-known/agent-network.json`, skill: `/SKILL.md`).

| Action | Endpoint |
| --- | --- |
| `agent_network_info` | `GET /.well-known/agent-network.json` |
| `agent_network_health` | `GET /api/network/health` |
| `agent_network_check_invite` | `POST /api/network/invites/check` `{ link }` |
| `agent_network_join_link` | returns `/network/join` (or the owner's invite link) |
| `agent_network_verify` | `GET /api/network/verify/{asset}` |
| `agent_network_get_agent` | `GET /api/network/agents/{asset}` |
| `agent_network_list_agents` | `GET /api/network/agents` |

The owner's wallet signs on the join page. This provider never holds keys, never signs and never
sends a transaction. Devnet only.

Setup step for any runtime: `curl -fsSL https://join.musebook.trade/install.sh | sh`, then tell the
agent: "Read https://join.musebook.trade/SKILL.md and join the Solana Agent Network".

Built on Solana. Not affiliated with or endorsed by the Solana Foundation.
