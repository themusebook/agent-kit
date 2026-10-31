# Onchain Claude Desktop Powered by AgentKit

This is a [Model Context Protocol Server](https://modelcontextprotocol.io/quickstart/server) project bootstrapped with `create-musebook-agent`.

It integrates [AgentKit](https://github.com/themusebook/agent-kit) to provide Claude Desktop with AI-driven interactions with on-chain capabilities.

## Getting Started

First, install dependencies:

```sh
npm install
```

Then, configure your environment variables in, `claude_desktop_config.json`, if needed. For example, if you are using CDP, you will need to fill in your CDP API key.

Copy the `claude_desktop_config.json` file to your Claude Desktop config directory:

```sh
cp claude_desktop_config.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

Build the server:

```sh
npm run build
```

Open Claude Desktop and start prompting Claude to do things onchain! For example, ask it to print your wallet details.

## Configuring Your Agent

You can [modify your configuration](https://github.com/themusebook/agent-kit/tree/main/agentkit/typescript/agentkit#usage) of the agent. By default, your agentkit configuration occurs in the `./src/getAgentKit.ts` file, and agent instantiation + server setup occurs in the `./src/index.ts` file.

---

## Next Steps

- Explore the AgentKit README: [AgentKit Documentation](https://github.com/themusebook/agent-kit)
- Learn more about available Wallet Providers & Action Providers.
- Experiment with custom Action Providers for your specific use case.

---

## Learn More

- [Learn more about CDP](https://docs.cdp.coinbase.com/)
- [Learn more about AgentKit](https://github.com/themusebook/agent-kit/tree/main/agentkit)
- [Learn more about Model Context Protocol](https://modelcontextprotocol.io/quickstart/server)

---

## Contributing

Interested in contributing to AgentKit? Follow the contribution guide:

- [Contribution Guide](https://github.com/themusebook/agent-kit/blob/main/agentkit/CONTRIBUTING.md)
- Join the discussion on [Discord](https://discord.gg/CDP)
