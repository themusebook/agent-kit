# @musebook/identity

Musebook Agent Kit — EIP-8004 identity: registration docs, mint flow, resolve/verify, Asset Signer PDA.

```sh
npm install @musebook/identity
```

Part of [Musebook Agent Kit](https://github.com/themusebook/agent-kit). Every write builds an **unsigned** transaction that you sign in your own wallet; this package never holds or reads private keys.

MIT licensed.

## Metaplex agent read + run (unsigned)

Import from `@musebook/identity/metaplex`. The main entry stays free of Metaplex deps. `checkRegistration`, `readAgentIdentityPlugin`, `readRegistrationDocument`, `readAgentWallet`,
`dasGetAgent`, `dasSearchAgents`, `buildRegisterExecutive`, `buildDelegateExecution`,
`verifyDelegation`, `buildRevokeExecution`, `buildCleanupApproval`. The builders return
unsigned transactions for your own wallet to sign. Fund the Asset Signer, not the asset
address. A delegate can make the Asset Signer sign **any** instruction. See
[docs/metaplex-agent-ops.md](../../docs/metaplex-agent-ops.md).
