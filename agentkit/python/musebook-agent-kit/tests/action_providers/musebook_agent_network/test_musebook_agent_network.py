"""Tests for the Solana Agent Network action provider."""

import json
from unittest.mock import MagicMock

from musebook_agent_kit.action_providers import musebook_agent_network_action_provider
from musebook_agent_kit.action_providers.musebook_agent_network.musebook_agent_network_action_provider import (
    MusebookAgentNetworkActionProvider,
)

ASSET = "zuvPkwqnZa9nnugh9YVhkWQym8yTGbfUy7GEothVi59"


def _session(body, status=200):
    """Test helper."""
    r = MagicMock(ok=status < 400, status_code=status, text=json.dumps(body))
    r.json.return_value = body
    s = MagicMock()
    s.get.return_value = r
    s.post.return_value = r
    return s


def test_factory():
    """Test factory."""
    assert musebook_agent_network_action_provider().name == "musebook_agent_network"


def test_health_hits_real_path():
    """Test health hits real path."""
    s = _session({"ok": True})
    p = MusebookAgentNetworkActionProvider(session=s)
    assert '"ok": true' in p.health({})
    assert s.get.call_args[0][0] == "https://join.musebook.trade/api/network/health"


def test_join_link_is_owner_signed_devnet():
    """Test join link is owner signed devnet."""
    out = MusebookAgentNetworkActionProvider(session=_session({})).join_link({})
    assert "https://join.musebook.trade/network/join" in out and "devnet" in out


def test_verify_joined_flags():
    """Test verify joined flags."""
    ok = MusebookAgentNetworkActionProvider(
        session=_session(
            {"identityRegistered": True, "pluginPresent": True, "nodeRegistered": True}
        )
    )
    assert json.loads(ok.verify({"asset": ASSET}))["joined"] is True
    no = MusebookAgentNetworkActionProvider(session=_session({"identityRegistered": False}))
    assert json.loads(no.verify({"asset": ASSET}))["joined"] is False


def test_errors_are_reported():
    """Test errors are reported."""
    p = MusebookAgentNetworkActionProvider(session=_session({"e": 1}, 503))
    assert "HTTP 503" in p.list_agents({})
