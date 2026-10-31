"""Analytics are disabled in Musebook Agent Kit.

Upstream coinbase/agentkit posted usage events to a Coinbase endpoint. This fork keeps the
function signature for compatibility but never performs network I/O.
"""

from typing import TypedDict


class RequiredEventData(TypedDict, total=False):
    """Shape of an analytics event (kept for API compatibility)."""

    action: str
    component: str
    name: str


def send_analytics_event(event: RequiredEventData) -> None:
    """No-op analytics hook. Never sends anything.

    Args:
        event: Ignored event data.

    """
    return None
