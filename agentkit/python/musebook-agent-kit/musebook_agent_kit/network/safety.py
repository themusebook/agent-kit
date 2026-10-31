"""Musebook Agent Kit network safety: Solana devnet by default, mainnet behind an opt-in flag."""

import os

DEFAULT_SOLANA_NETWORK_ID = "solana-devnet"
MAINNET_FLAG_ENV = "MUSEBOOK_ENABLE_MAINNET"


def is_mainnet_enabled() -> bool:
    """Return True only when MUSEBOOK_ENABLE_MAINNET is exactly "true" (default: False)."""
    return os.getenv(MAINNET_FLAG_ENV) == "true"


def assert_solana_network_allowed(network_id: str) -> None:
    """Raise unless the network is non-mainnet or mainnet was explicitly enabled.

    Args:
        network_id: The Solana network id about to be used.

    Raises:
        ValueError: If mainnet is requested while disabled.

    """
    if network_id == "solana-mainnet" and not is_mainnet_enabled():
        raise ValueError(
            f"Solana mainnet is disabled by default. Set {MAINNET_FLAG_ENV}=true to opt in."
        )
