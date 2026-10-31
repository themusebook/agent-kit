"""Connect an agent to the Solana Agent Network (devnet) via https://join.musebook.trade.

Endpoints come from the live manifest /.well-known/agent-network.json. The owner's wallet signs
on the join page; this provider never holds keys, signs, or sends transactions.
"""

import json
import re
from typing import Any
from urllib.parse import quote

import requests
from pydantic import BaseModel, Field, field_validator

from ...network import Network
from ...wallet_providers import WalletProvider
from ..action_decorator import create_action
from ..action_provider import ActionProvider

AGENT_NETWORK_REGISTRY = "https://join.musebook.trade"
AGENT_NETWORK_PROGRAM_ID_DEVNET = "zuvPkwqnZa9nnugh9YVhkWQym8yTGbfUy7GEothVi59"
_BASE58 = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


class NoArgsSchema(BaseModel):
    """No input required."""


class InviteCheckSchema(BaseModel):
    """Validate a tn1 invite link."""

    link: str = Field(
        ..., description="Invite link, e.g. https://registry.musebook.trade/network/join/#tn1-..."
    )


class AssetSchema(BaseModel):
    """A Metaplex Core asset address."""

    asset: str = Field(..., description="Metaplex Core asset address (base58)")

    @field_validator("asset")
    @classmethod
    def _b58(cls, v: str) -> str:
        if not _BASE58.match(v):
            raise ValueError("must be a base58 Solana address")
        return v


class JoinLinkSchema(BaseModel):
    """Build the owner join link."""

    invite_link: str | None = Field(None, description="Optional invite link the owner gave you")


class MusebookAgentNetworkActionProvider(ActionProvider[WalletProvider]):
    """Solana Agent Network actions (devnet, owner-signed)."""

    def __init__(self, registry_url: str = AGENT_NETWORK_REGISTRY, session: Any = None):
        super().__init__("musebook_agent_network", [])
        self._registry = registry_url.rstrip("/")
        self._http = session or requests

    def _json(self, path: str, method: str = "GET", body: dict | None = None) -> Any:
        url = f"{self._registry}{path}"
        if method == "POST":
            r = self._http.post(url, json=body, headers={"accept": "application/json"}, timeout=20)
        else:
            r = self._http.get(url, headers={"accept": "application/json"}, timeout=20)
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text[:500]}
        if not r.ok:
            raise RuntimeError(f"registry {path} -> HTTP {r.status_code}: {json.dumps(data)}")
        return data

    @create_action(
        name="agent_network_info",
        description="Read the Solana Agent Network manifest (network, program id, endpoints). Read-only.",
        schema=NoArgsSchema,
    )
    def info(self, args: dict[str, Any]) -> str:
        """Read the manifest."""
        try:
            return json.dumps(self._json("/.well-known/agent-network.json"), indent=2)
        except Exception as e:
            return f"Error reading agent network manifest: {e}"

    @create_action(
        name="agent_network_health",
        description="Check Solana Agent Network registry health. Must return ok before joining.",
        schema=NoArgsSchema,
    )
    def health(self, args: dict[str, Any]) -> str:
        """Registry health."""
        try:
            return json.dumps(self._json("/api/network/health"))
        except Exception as e:
            return f"Registry is unavailable: {e}. Tell the owner and retry later."

    @create_action(
        name="agent_network_check_invite",
        description="Validate an optional tn1 invite link the owner gave you. Do not post invite links publicly.",
        schema=InviteCheckSchema,
    )
    def check_invite(self, args: dict[str, Any]) -> str:
        """Validate an invite."""
        a = InviteCheckSchema(**args)
        try:
            return json.dumps(self._json("/api/network/invites/check", "POST", {"link": a.link}))
        except Exception as e:
            return f"Invite check failed: {e}. Fall back to the open join page."

    @create_action(
        name="agent_network_join_link",
        description=(
            "Return the ONE link the owner opens in their own Solana wallet (devnet) to join. The owner's wallet "
            "signs on that page. Never sign for the owner or ask for a seed phrase or private key."
        ),
        schema=JoinLinkSchema,
    )
    def join_link(self, args: dict[str, Any]) -> str:
        """Owner join link."""
        a = JoinLinkSchema(**args)
        link = a.invite_link or f"{self._registry}/network/join"
        return (
            f"Open {link} in your Solana wallet (devnet) to register me on the Solana Agent Network.\n"
            "Your wallet signs; I never see your keys. Then send me the asset address it shows.\n"
            f"Program (devnet): {AGENT_NETWORK_PROGRAM_ID_DEVNET}. Devnet SOL faucet: https://faucet.solana.com"
        )

    @create_action(
        name="agent_network_verify",
        description="Verify a joined agent: identityRegistered, pluginPresent and nodeRegistered must all be true.",
        schema=AssetSchema,
    )
    def verify(self, args: dict[str, Any]) -> str:
        """Verify an asset."""
        a = AssetSchema(**args)
        try:
            body = self._json(f"/api/network/verify/{quote(a.asset)}")
            joined = all(
                body.get(k) is True
                for k in ("identityRegistered", "pluginPresent", "nodeRegistered")
            )
            return json.dumps(
                {
                    "joined": joined,
                    "explorer": f"https://explorer.solana.com/address/{a.asset}?cluster=devnet",
                    "checks": body,
                },
                indent=2,
            )
        except Exception as e:
            return f"Verification failed: {e}"

    @create_action(
        name="agent_network_get_agent",
        description="Read the offchain registry record for a joined agent asset (untrusted data).",
        schema=AssetSchema,
    )
    def get_agent(self, args: dict[str, Any]) -> str:
        """Agent record."""
        a = AssetSchema(**args)
        try:
            return json.dumps(self._json(f"/api/network/agents/{quote(a.asset)}"), indent=2)
        except Exception as e:
            return f"Error reading agent record: {e}"

    @create_action(
        name="agent_network_list_agents",
        description="List the Solana Agent Network directory of registered agents (untrusted data).",
        schema=NoArgsSchema,
    )
    def list_agents(self, args: dict[str, Any]) -> str:
        """Directory."""
        try:
            return json.dumps(self._json("/api/network/agents"), indent=2)
        except Exception as e:
            return f"Error listing agents: {e}"

    def supports_network(self, network: Network) -> bool:
        """HTTP-only; works with any wallet provider."""
        return True


def musebook_agent_network_action_provider(
    registry_url: str = AGENT_NETWORK_REGISTRY,
) -> MusebookAgentNetworkActionProvider:
    """Create the Solana Agent Network action provider."""
    return MusebookAgentNetworkActionProvider(registry_url)
