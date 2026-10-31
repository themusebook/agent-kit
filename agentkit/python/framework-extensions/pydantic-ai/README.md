# Musebook Agent Kit PydanticAI Extension

This package provides integration between Musebook Agent Kit and PydanticAI, allowing you to use AgentKit actions as tools in PydanticAI agents.

## Setup

### Prerequisites

- [CDP API Key](https://portal.cdp.coinbase.com/access/api)
- [OpenAI API Key](https://platform.openai.com/docs/quickstart#create-and-export-an-api-key)

### Installation

```bash
pip install musebook-agent-kit musebook-agent-kit-pydantic-ai
```

### Environment Setup

Set the following environment variables:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
export CDP_API_KEY_ID=<your-cdp-api-key-id>
export CDP_API_KEY_SECRET=<your-cdp-api-key-secret>
export CDP_WALLET_SECRET=<your-cdp-wallet-secret>
export NETWORK_ID=<your-network-id>
```

## Usage

### Basic Setup

```python
from musebook_agent_kit import AgentKit
from musebook_agent_kit_pydantic_ai import get_pydantic_ai_tools
from pydantic_ai import Agent

# Initialize AgentKit
agent_kit = AgentKit()

# Get PydanticAI compatible tools
tools = get_pydantic_ai_tools(agent_kit)

# Create PydanticAI agent with the tools
agent = Agent(
    'openai:gpt-4o',
    tools=tools,
    system_prompt='You are a helpful crypto trading assistant.'
)

# Use the agent
result = agent.run_sync('What is my wallet balance?')
print(result.output)
```

For AgentKit configuration options, see the [Musebook Agent Kit README](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/musebook-agent-kit/README.md).

For a full example, see the [chatbot example](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/examples/pydantic-ai-cdp-chatbot/chatbot.py).

For PydanticAI configuration options, see the [PydanticAI Documentation](https://ai.pydantic.dev/).

## Contributing

See [CONTRIBUTING.md](https://github.com/themusebook/agent-kit/blob/main/agentkit/CONTRIBUTING.md) for detailed setup instructions and contribution guidelines.
