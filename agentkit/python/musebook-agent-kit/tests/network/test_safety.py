"""Tests for Musebook network safety defaults."""

import pytest

from musebook_agent_kit.network.safety import (
    DEFAULT_SOLANA_NETWORK_ID,
    assert_solana_network_allowed,
    is_mainnet_enabled,
)


def test_devnet_is_default():
    """Devnet is the default network."""
    assert DEFAULT_SOLANA_NETWORK_ID == "solana-devnet"


def test_mainnet_disabled_by_default(monkeypatch):
    """Mainnet is refused without the flag."""
    monkeypatch.delenv("MUSEBOOK_ENABLE_MAINNET", raising=False)
    assert not is_mainnet_enabled()
    with pytest.raises(ValueError):
        assert_solana_network_allowed("solana-mainnet")
    assert_solana_network_allowed("solana-devnet")


def test_mainnet_opt_in(monkeypatch):
    """Mainnet works only with the explicit flag."""
    monkeypatch.setenv("MUSEBOOK_ENABLE_MAINNET", "true")
    assert_solana_network_allowed("solana-mainnet")
