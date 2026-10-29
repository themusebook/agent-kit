# @musebook/perps

Musebook Agent Kit — perps venue descriptors and pre-trade risk types for Phoenix-routed venues (Imperial), grounded in the owner's clawd-agents-perps / clawd-perps-agent stacks. Descriptor-level only: the kit never holds keys and never broadcasts; every order is a plan the caller reviews, risk-checks, and signs.

```sh
npm install @musebook/perps
```

Part of [Musebook Agent Kit](https://github.com/themusebook/agent-kit). Every write builds an **unsigned** transaction that you sign in your own wallet; this package never holds or reads private keys.

MIT licensed.
