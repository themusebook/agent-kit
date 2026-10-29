# Metaplex agent ops (read + run)

Built from https://www.metaplex.com/docs/agents/read-agent-data and
https://www.metaplex.com/docs/agents/run-an-agent, checked on 2026-10-29 against
`@metaplex-foundation/mpl-agent-registry@0.2.6`, `mpl-core@1.10.0`, and `mpl-toolbox@0.10.0`.

| Side | `@musebook/identity/metaplex` | `musebook` CLI |
| --- | --- | --- |
| Registration (null when unregistered) | `checkRegistration` (safeFetchAgentIdentityV1), `fetchIdentityFromSeeds` (throws) | `agent read <asset>` |
| AgentIdentity plugin (uri + transfer/update/execute) | `readAgentIdentityPlugin`, `agentIdentityPlugin` | `agent read` |
| ERC-8004 registration doc (non-OK HTTP throws) | `readRegistrationDocument` | `agent read` |
| Agent wallet = Asset Signer + balance | `readAgentWallet` | `agent wallet <asset>` |
| DAS getAsset / searchAssets | `dasGetAgent`, `dasSearchAgents`, `dasSearchParams` | `agent read --das`, `agent search` |
| Register executive (unsigned) | `buildRegisterExecutive` | `agent executive register --wallet W` |
| Delegate execution (owner, unsigned) | `buildDelegateExecution` | `agent delegate --wallet OWNER --asset A --executive E` |
| Verify delegation | `verifyDelegation` | `agent delegation --asset A --executive E` |
| Revoke (owner or executive, unsigned) | `buildRevokeExecution` | `agent revoke ... [--destination D]` |
| SPL approval cleanup (owner, unsigned) | `buildCleanupApproval` | `agent cleanup-approval --wallet OWNER --asset A --mint M` |

Discovery (`@musebook/a2a-network` `discoverNetwork`) uses DAS `searchAssets` with
`{ isAgent: true, interface: "MplCoreAsset" }`.

**Fund the Asset Signer, not the asset address.** `findAssetSignerPda` and the DAS
`asset_signer` field are the same PDA. The kit checks that they match on every DAS row
(`signerAgrees`).

**Operational authority.** An execution delegate may cause the agent's Asset Signer to
sign *any* instruction passed through Core's Execute hook. Revoking stops future
executions only. It doesn't unwind earlier state such as SPL approvals, escrows, or
delegated authorities.

DAS responses use snake_case (`is_agent`, `asset_signer`, `agent_token`). `searchAssets`
params use camelCase (`isAgent`, `agentToken`, `assetSigner`).

Transaction builders use umi noop signers and return a serialized **unsigned** v0
transaction (base64; the CLI also prints hex). Nothing here signs or sends a
transaction, and nothing generates a keypair.

## Where the docs differ from the installed SDK

1. The executive profile and delegation record PDAs live under the **Agent Tools**
   program `TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S`, not the Agent Registry (identity)
   program `1DREG…`. The run-an-agent page gives seeds but no program ID. The delegation
   record seeds are `["execution_delegate_record", executiveProfile, agentAsset]`.
2. `lifecycleChecks` in mpl-core 1.10 has the type `CheckResult[]` (`[0]` = CAN_LISTEN).
   The read-agent-data page prints `{ __kind: 'Listen' }`. The kit accepts both.
3. The SPL cleanup example calls `findAssociatedTokenPda` / `revokeTokenDelegate` on a umi
   built from `umi-bundle-defaults` alone. That fails with `ProgramNotRecognizedError
   [splAssociatedToken]` unless `mplToolbox()` is also registered.
4. `delegateExecutionV1` in the docs leaves out `executionDelegateRecord`. The SDK fills it
   in from the default PDA resolver, so the example works as written.
5. mpl-agent-registry 0.2.6 bundles its own nested `mpl-core@1.8.0`. The kit and CLI use
   1.10.0 for `fetchAsset`, `execute`, and `findAssetSignerPda`.
6. The docs' example DAS values check out: `84jw9…` → `6ttUw…` and `1RUC5…` → `DwgDr…`
   are both correct Asset Signer derivations, and they serve as test fixtures.
