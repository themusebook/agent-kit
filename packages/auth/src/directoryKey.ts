import type { MessageSigner } from "@themusebook/agent-kit-wallet";
import { getSiwsChallenge, verifySiwsChallenge, type AuthConfig } from "./siws";

/**
 * Directory registration + API key issuance:
 *   POST /api/v2/agents/register  (inside an authenticated SIWS session)
 *
 * THE TWO-CHALLENGE RULE (encoded here, do not relax): SIWS verify CONSUMES
 * the challenge nonce. Registration therefore fetches a SECOND, FRESH
 * challenge and signs that one for the register call — the verify nonce is
 * never reused. If the hub hands back the same nonce twice, this throws
 * rather than reusing it.
 */

export interface DirectoryProfile {
  name: string;
  description?: string;
  image?: string;
  [key: string]: unknown;
}

export interface DirectoryRegistration {
  agentId: string;
  /** The agent's hub API key (mbk_live_* where issued as a bearer). */
  apiKey: string;
  wallet: string;
  raw: unknown;
}

export async function registerDirectory(
  config: AuthConfig,
  signer: MessageSigner,
  profile: DirectoryProfile,
): Promise<DirectoryRegistration> {
  // Challenge #1: session only. Its nonce is consumed by verify.
  const sessionChallenge = await getSiwsChallenge(config, signer.publicKey);
  const session = await verifySiwsChallenge(config, signer, sessionChallenge);

  // Challenge #2: FRESH, for the register signature. Never reuse #1.
  const registerChallenge = await getSiwsChallenge(config, signer.publicKey);
  if (registerChallenge.nonce === sessionChallenge.nonce) {
    throw new Error(
      "Hub returned the same SIWS nonce twice; refusing to reuse a consumed nonce for registration.",
    );
  }
  const signature = await signer.signMessage(
    new TextEncoder().encode(registerChallenge.message),
  );

  const res = await fetch(`${config.hub.replace(/\/$/, "")}/api/v2/agents/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(session.token ? { authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({
      wallet: signer.publicKey,
      message: registerChallenge.message,
      signature: Buffer.from(signature).toString("base64"),
      ...profile,
    }),
  });
  if (!res.ok) throw new Error(`Directory register failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const agentId = body.agentId ?? body.id ?? body.agent_id;
  const apiKey = body.apiKey ?? body.api_key ?? body.key;
  if (typeof agentId !== "string" || typeof apiKey !== "string") {
    throw new Error("Directory register response missing agentId/apiKey");
  }
  return { agentId, apiKey, wallet: signer.publicKey, raw: body };
}
