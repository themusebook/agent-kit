import type { MessageSigner } from "@themusebook/agent-kit-wallet";

/**
 * SIWS (Sign-In With Solana) against the Musebook hub.
 * Endpoints (ARCHITECTURE §3, LIVE):
 *   POST /api/siws/challenge        → { nonce, message, expiresAt }
 *   POST /api/auth/solana/verify    → session (Better Auth)
 * ASSUMPTION: request/response field names follow the hub's documented
 * shapes; they are read defensively.
 */

export interface AuthConfig {
  hub: string;
}

export interface SiwsChallenge {
  nonce: string;
  /** The exact human-readable message to sign. */
  message: string;
  expiresAt?: string;
}

export interface SiwsSession {
  token: string | null;
  wallet: string;
  agentId: string | null;
  raw: unknown;
}

function base(hub: string): string {
  return hub.replace(/\/$/, "");
}

export async function getSiwsChallenge(
  config: AuthConfig,
  wallet: string,
): Promise<SiwsChallenge> {
  const res = await fetch(`${base(config.hub)}/api/siws/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  if (!res.ok) throw new Error(`SIWS challenge failed: HTTP ${res.status}`);
  const body = (await res.json()) as Partial<SiwsChallenge>;
  if (!body.nonce || !body.message) throw new Error("SIWS challenge response missing nonce/message");
  return { nonce: body.nonce, message: body.message, expiresAt: body.expiresAt };
}

function toBase64(sig: Uint8Array): string {
  return Buffer.from(sig).toString("base64");
}

/** Sign a challenge with the caller's signer and exchange it for a session. */
export async function verifySiwsChallenge(
  config: AuthConfig,
  signer: MessageSigner,
  challenge: SiwsChallenge,
): Promise<SiwsSession> {
  const signature = await signer.signMessage(new TextEncoder().encode(challenge.message));
  const res = await fetch(`${base(config.hub)}/api/auth/solana/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: signer.publicKey,
      nonce: challenge.nonce,
      message: challenge.message,
      signature: toBase64(signature),
    }),
  });
  if (!res.ok) throw new Error(`SIWS verify failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  return {
    token: typeof body.token === "string" ? body.token : null,
    wallet: signer.publicKey,
    agentId: typeof body.agentId === "string" ? body.agentId : null,
    raw: body,
  };
}

/** One-shot: fresh challenge → sign → verify. Consumes the nonce. */
export async function siwsSignIn(
  config: AuthConfig,
  signer: MessageSigner,
): Promise<SiwsSession> {
  const challenge = await getSiwsChallenge(config, signer.publicKey);
  return verifySiwsChallenge(config, signer, challenge);
}
