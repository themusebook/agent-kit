# AgentKit LangChain Extension

LangChain extension of AgentKit. Enables agentic workflows to interact with onchain actions.

## Setup

### Prerequisites

- [CDP API Key](https://portal.cdp.coinbase.com/access/api)
- [OpenAI API Key](https://platform.openai.com/docs/quickstart#create-and-export-an-api-key)

### Installation

```bash
pip install musebook-agent-kit musebook-agent-kit-langchain
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
from musebook_agent_kit_langchain import get_langchain_tools

agentKit = AgentKit()

tools = get_langchain_tools(agentKit)

llm = ChatOpenAI(model="gpt-4o-mini")

agent = create_react_agent(
    llm=llm,
    tools=tools,
)
```

For AgentKit configuration options, see the [Musebook Agent Kit README](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/musebook-agent-kit/README.md).

For a full example, see the [chatbot example](https://github.com/themusebook/agent-kit/blob/main/agentkit/python/examples/langchain-cdp-smart-wallet-chatbot/chatbot.py).

## Contributing

See [CONTRIBUTING.md](https://github.com/themusebook/agent-kit/blob/main/agentkit/CONTRIBUTING.md) for detailed setup instructions and contribution guidelines.
