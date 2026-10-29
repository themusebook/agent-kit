import { PublicKey } from "@solana/web3.js";
import {
  deriveAssetSignerPda,
  type MetaplexNetwork,
} from "@themusebook/agent-kit-identity";
import {
  GenesisApiError,
  GenesisApiNetworkError,
  GenesisValidationError,
} from "./errors";

/**
 * Agent token launches via Metaplex Genesis — the `createAndRegisterLaunch`
 * flow: one hosted-API call creates the agent's token on a bonding curve
 * and (with `agent.setToken: true`) permanently binds it to the agent's
 * Core asset in the same launch.
 *
 * Grounding: the owner's RWA stack (themusebook/solana-rwa-agents,
 * agents/types.ts + agents/launch.ts) shapes this exact payload:
 *   POST https://api.metaplex.com/v1/genesis/launch
 *   { wallet, agent: { mint, setToken }, launchType: 'bondingCurve',
 *     token: { name, symbol, image, description?, externalLinks? },
 *     launch: { ... }, network? }
 *
 * This package BUILDS and validates payloads. Submission happens only
 * through a caller-supplied adapter (or the HTTP adapter below, when the
 * caller explicitly invokes it) — the kit never holds keys and never
 * broadcasts on its own initiative.
 */

export const GENESIS_API_BASE = "https://api.metaplex.com";
export const GENESIS_LAUNCH_PATH = "/v1/genesis/launch";
export const GENESIS_LAUNCH_URL = `${GENESIS_API_BASE}${GENESIS_LAUNCH_PATH}`;

export interface GenesisExternalLinks {
  website?: string;
  twitter?: string;
  telegram?: string;
}

export interface GenesisTokenMetadataInput {
  /** 1–32 characters. */
  name: string;
  /** 1–10 characters. */
  symbol: string;
  /** MUST be an Irys gateway URL (https://gateway.irys.xyz/...). */
  image: string;
  /** At most 250 characters. */
  description?: string;
  externalLinks?: GenesisExternalLinks;
}

export interface CreateAndRegisterLaunchInput {
  /** The launching wallet (pays + signs via the caller's adapter). */
  wallet: string;
  agent: {
    /** The agent's MPL Core asset address. */
    mint: string;
    /**
     * Permanently bind the launched token as the agent's token
     * (agent_token). ONE-SHOT and IRREVERSIBLE — a second bind fails.
     * Devnet guidance: test with setToken: false; only set it on the real
     * mint.
     */
    setToken: boolean;
  };
  token: GenesisTokenMetadataInput;
  launch?: {
    /**
     * Optional first buy amount, in the curve's quote units. The first
     * buy is FEE-FREE (no launch fee is taken on it).
     */
    firstBuyAmount?: string | number;
    [key: string]: unknown;
  };
  network?: MetaplexNetwork;
  /**
   * Where creator fees accrue. DEFAULT: the agent's Asset Signer PDA —
   * the keyless identity treasury. Override only deliberately.
   */
  creatorFeeWallet?: string;
}

export interface CreateAndRegisterLaunchPayload {
  kind: "createAndRegisterLaunch";
  /** Where a submit adapter posts the body. */
  endpoint: string;
  body: {
    wallet: string;
    agent: { mint: string; setToken: boolean };
    launchType: "bondingCurve";
    token: GenesisTokenMetadataInput;
    launch: Record<string, unknown>;
    network?: MetaplexNetwork;
  };
  /** Resolved creator-fee destination (Asset Signer PDA unless overridden). */
  creatorFeeWallet: string;
  warnings: string[];
}

function assertPubkey(field: string, value: string): void {
  try {
    new PublicKey(value);
  } catch {
    throw new GenesisValidationError(field, `${field} must be a valid Solana public key`);
  }
}

const IRYS_IMAGE = /^https:\/\/gateway\.irys\.xyz\/.+/;

/**
 * Token metadata validation for a Genesis launch. Returns field problems;
 * empty means valid. (The builder below throws on the first problem.)
 */
export function validateGenesisTokenMetadata(
  token: GenesisTokenMetadataInput,
): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];
  if (!token.name || token.name.length < 1 || token.name.length > 32) {
    problems.push({ field: "token.name", message: "token name must be 1–32 characters" });
  }
  if (!token.symbol || token.symbol.length < 1 || token.symbol.length > 10) {
    problems.push({ field: "token.symbol", message: "token symbol must be 1–10 characters" });
  }
  if (!token.image || !IRYS_IMAGE.test(token.image)) {
    problems.push({
      field: "token.image",
      message: "token image MUST be an Irys gateway URL (https://gateway.irys.xyz/...)",
    });
  }
  if (token.description !== undefined && token.description.length > 250) {
    problems.push({
      field: "token.description",
      message: "token description must be at most 250 characters",
    });
  }
  return problems;
}

/**
 * Build (and validate) a createAndRegisterLaunch payload. Pure: no I/O,
 * no signing, no broadcast. Submission is the adapter's job.
 */
export function buildCreateAndRegisterLaunch(
  input: CreateAndRegisterLaunchInput,
): CreateAndRegisterLaunchPayload {
  assertPubkey("wallet", input.wallet);
  assertPubkey("agent.mint", input.agent.mint);
  if (typeof input.agent.setToken !== "boolean") {
    throw new GenesisValidationError("agent.setToken", "agent.setToken must be a boolean");
  }
  const tokenProblems = validateGenesisTokenMetadata(input.token);
  if (tokenProblems.length > 0) {
    const first = tokenProblems[0]!;
    throw new GenesisValidationError(first.field, first.message);
  }
  if (input.creatorFeeWallet) assertPubkey("creatorFeeWallet", input.creatorFeeWallet);

  const warnings: string[] = [];
  if (input.agent.setToken) {
    warnings.push(
      "setToken: true PERMANENTLY binds this token to the agent (one-shot, irreversible).",
    );
    if (input.network === "solana-devnet") {
      warnings.push(
        "devnet guidance: test with setToken: false — do not burn the permanent bind on a test mint.",
      );
    }
  }

  return {
    kind: "createAndRegisterLaunch",
    endpoint: GENESIS_LAUNCH_URL,
    body: {
      wallet: input.wallet,
      agent: { mint: input.agent.mint, setToken: input.agent.setToken },
      launchType: "bondingCurve",
      token: input.token,
      launch: { ...(input.launch ?? {}) },
      ...(input.network ? { network: input.network } : {}),
    },
    // Creator fees route to the agent's own keyless treasury by default.
    creatorFeeWallet:
      input.creatorFeeWallet ?? deriveAssetSignerPda(input.agent.mint).toBase58(),
    warnings,
  };
}

/**
 * Launch lifecycle: the token trades on the Genesis bonding curve first;
 * at graduation the pool AUTO-MIGRATES to a Raydium CPMM pool. There is no
 * manual migration step for the agent or the kit to perform.
 */
export type AgentLaunchPhase = "bondingCurve" | "graduated";

export interface AgentLaunchStatus {
  phase: AgentLaunchPhase;
  /** Set when phase is "graduated": the migration target venue/pool type. */
  graduationVenue?: "raydium-cpmm";
}

/** Caller-supplied submission channel for a built launch payload. */
export interface GenesisLaunchAdapter {
  submit(
    payload: CreateAndRegisterLaunchPayload,
  ): Promise<{ signature?: string; launch?: string; raw?: unknown }>;
}

/**
 * The stock HTTP adapter: POSTs the payload body to the Genesis launch
 * endpoint and maps failures onto the Genesis error taxonomy. Invoking
 * `submit` IS the broadcast decision — builders never call it for you.
 */
export function createGenesisHttpAdapter(
  fetchImpl: typeof fetch = fetch,
): GenesisLaunchAdapter {
  return {
    async submit(payload) {
      let res: Response;
      try {
        res = await fetchImpl(payload.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload.body),
        });
      } catch (e) {
        throw new GenesisApiNetworkError(
          `Could not reach the Genesis API at ${payload.endpoint}`,
          e,
        );
      }
      const bodyText = await res.text();
      if (!res.ok) {
        throw new GenesisApiError(
          res.status,
          `Genesis launch API failed: HTTP ${res.status}`,
          bodyText,
        );
      }
      let raw: unknown = bodyText;
      try {
        raw = JSON.parse(bodyText);
      } catch {
        /* keep the raw text */
      }
      const obj = (raw ?? {}) as Record<string, unknown>;
      return {
        signature: typeof obj.signature === "string" ? obj.signature : undefined,
        launch: typeof obj.launch === "string" ? obj.launch : undefined,
        raw,
      };
    },
  };
}
