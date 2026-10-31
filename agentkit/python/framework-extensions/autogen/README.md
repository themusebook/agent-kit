# AgentKit Autogen Extension

Microsoft Autogen extension of AgentKit. Enables agentic workflows to interact with onchain actions.

## Setup

### Prerequisites

- [CDP API Key](https://portal.cdp.coinbase.com/access/api)
- [OpenAI API Key](https://platform.openai.com/docs/quickstart#create-and-export-an-api-key)

### Installation

```bash
pip install musebook-agent-kit musebook-agent-kit-autogen
```

### Environment Setup

Set the following environment variables:

```bash
export OPENAI_API_KEY=<your-openai-api-key>
export CDP_API_KEY_ID=<your-cdp-api-key-id>
export CDP_API_KEY_PRIVATE=<your-cdp-api-key-private>
```

## Usage

### Basic Setup

```python
from musebook_agent_kit import AgentKit
from musebook_agent_kit_autogen import get_autogen_tools

from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.ui import Console


agentKit = AgentKit()

model_client = OpenAIChatCompletionClient(model="gpt-4o-mini")

tools = get_autogen_tools(agentKit)

agent = AssistantAgent(
    name="assistant",
    model_client=model_client,
    tools=tools,
    system_message="You are a helpful agent"
)

async def main() -> None:
    await Console(agent.run_stream(task="Show me my wallet information."))
    await model_client.close()

await main()

```

For AgentKit configuration options, see the [Musebook Agent Kit README](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/musebook-agent-kit/README.md).

For Autogen configuration options, see the [Autogen Documentation](https://microsoft.github.io/autogen/stable/index.html)

For a full example, see the [chatbot example](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/examples/autogen-cdp-chatbot/chatbot.py).

## Contributing

See [CONTRIBUTING.md](https://github.com/themusebook/agent-kit/blob/main/agentkit/CONTRIBUTING.md) for detailed setup instructions and contribution guidelines.
