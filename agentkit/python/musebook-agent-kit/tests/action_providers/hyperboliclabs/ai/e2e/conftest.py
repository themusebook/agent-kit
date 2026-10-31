"""Fixtures for AI service end-to-end tests."""

import pytest

from musebook_agent_kit.action_providers.hyperboliclabs.ai.service import AIService


@pytest.fixture
def ai_service(api_key: str) -> AIService:
    """Create AIService instance for testing.

    Args:
        api_key: API key for authentication.

    Returns:
        AIService: Instance of AIService for testing.

    """
    return AIService(api_key)
