import { PublicKey } from "@solana/web3.js";
import {
  deriveAgentIdentityPda,
  deriveAssetSignerPda,
} from "@musebook/identity";
import { GenesisValidationError, PermanentBindingRefusalError } from "./errors";

/**
 * setAgentTokenV1 — permanently bind a token mint as an agent's canonical
 * `agent_token`.
 *
 * ⚠️ PERMANENCE: this is ONE-SHOT and IRREVERSIBLE. Once set, the binding
 * cannot be changed or cleared; a second setAgentTokenV1 on the same
 * asset fails. That is why this builder REFUSES to run unless the caller
 * passes `acknowledgePermanent: true` — an accidental bind is forever.
 *
 * Execution shape (grounded in the owner's RWA stack,
 * docs/agent-pairing.md): `buildSetAgentToken` wraps setAgentTokenV1 in
 * MPL Core **Execute**, so the authority is the agent's Asset Signer PDA —
 * the non-atomic bind path used when the launch itself did not set the
 * token (the atomic path is createAndRegisterLaunch with setToken: true).
 *
 * This module builds the typed descriptor only; the caller's SDK/adapter
 * executes it with the caller's signer.
 */

export interface SetAgentTokenV1Input {
  /** The agent's MPL Core asset. */
  asset: string;
  /** The token mint to bind permanently as agent_token. */
  tokenMint: string;
  /**
   * REQUIRED opt-in: must be exactly `true`, acknowledging the binding is
   * permanent and one-shot. Anything else → PermanentBindingRefusalError.
   */
  acknowledgePermanent?: boolean;
  /** Optional collection the asset belongs to. */
  collection?: string;
}

export interface SetAgentTokenV1Descriptor {
  kind: "setAgentTokenV1";
  /** The instruction executes via Core Execute from the Asset Signer PDA. */
  via: "core-execute";
  asset: string;
  collection: string | null;
  tokenMint: string;
  /** The executing authority: the agent's keyless Asset Signer PDA. */
  assetSigner: string;
  agentIdentityPda: string;
  /** Always true — the descriptor cannot represent a reversible bind. */
  permanent: true;
}

export function buildSetAgentTokenV1(
  input: SetAgentTokenV1Input,
): SetAgentTokenV1Descriptor {
  if (input.acknowledgePermanent !== true) {
    throw new PermanentBindingRefusalError("setAgentTokenV1");
  }
  for (const [field, value] of [
    ["asset", input.asset],
    ["tokenMint", input.tokenMint],
    ...(input.collection ? [["collection", input.collection] as const] : []),
  ] as Array<readonly [string, string]>) {
    try {
      new PublicKey(value);
    } catch {
      throw new GenesisValidationError(field, `${field} must be a valid Solana public key`);
    }
  }
  return {
    kind: "setAgentTokenV1",
    via: "core-execute",
    asset: input.asset,
    collection: input.collection ?? null,
    tokenMint: input.tokenMint,
    assetSigner: deriveAssetSignerPda(input.asset).toBase58(),
    agentIdentityPda: deriveAgentIdentityPda(input.asset).toBase58(),
    permanent: true,
  };
}
