import type { AuthConfig } from "./siws";

/**
 * Agent Auth (Better Auth agent-auth, 1.0-draft) — the provider layer
 * Musebook operates. Flow: Discover → Register → Approve → Execute.
 *
 * Discovery is LIVE: GET {provider}/.well-known/agent-configuration
 * (provider_name "musebook", Ed25519, modes [delegated, autonomous],
 * approval via device_authorization). Registration happens INSIDE an
 * authenticated SIWS session; approval is a device-authorization grant —
 * the human approves on their device. Nothing auto-grants.
 * ASSUMPTION: endpoint paths are taken from the discovery document when it
 * names them, with the documented hub paths as fallbacks.
 */

export type AgentAuthMode = "delegated" | "autonomous";

export interface AgentConfiguration {
  provider_name?: string;
  issuer: string;
  version?: string;
  modes?: AgentAuthMode[];
  approval?: string[];
  endpoints?: Record<string, string>;
  registration_endpoint?: string;
  device_authorization_endpoint?: string;
  grant_status_endpoint?: string;
  [key: string]: unknown;
}

export async function discoverAgentAuth(
  providerBaseUrl: string,
): Promise<AgentConfiguration> {
  const base = providerBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/agent-configuration`);
  if (!res.ok) throw new Error(`Agent Auth discovery failed: HTTP ${res.status}`);
  return (await res.json()) as AgentConfiguration;
}

export interface AgentRegistrationInput {
  name: string;
  /** Ed25519 public key (base58 or base64, as the agent generated it). */
  publicKey: string;
  mode: AgentAuthMode;
}

export interface AgentRegistrationResult {
  agentId: string | null;
  status: "pending" | "approved" | "unknown";
  /** Where the human approves this agent (device authorization). */
  verificationUri: string | null;
  userCode: string | null;
  grantId: string | null;
  raw: unknown;
}

function endpoint(config: AgentConfiguration, key: string, fallbackPath: string): string {
  const fromDoc = config.endpoints?.[key] ?? (config as Record<string, unknown>)[`${key}_endpoint`];
  if (typeof fromDoc === "string") return fromDoc;
  return `${config.issuer.replace(/\/$/, "")}${fallbackPath}`;
}

export async function registerAgentAuth(
  config: AuthConfig,
  configuration: AgentConfiguration,
  sessionToken: string | null,
  input: AgentRegistrationInput,
): Promise<AgentRegistrationResult> {
  const url = endpoint(configuration, "registration", "/api/auth/agent/register");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: JSON.stringify({
      name: input.name,
      public_key: input.publicKey,
      mode: input.mode,
    }),
  });
  if (!res.ok) throw new Error(`Agent Auth register failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const status = body.status;
  return {
    agentId: typeof body.agentId === "string" ? body.agentId : typeof body.id === "string" ? body.id : null,
    status: status === "approved" ? "approved" : status === "pending" ? "pending" : "unknown",
    verificationUri:
      typeof body.verification_uri_complete === "string"
        ? body.verification_uri_complete
        : typeof body.verification_uri === "string"
          ? body.verification_uri
          : null,
    userCode: typeof body.user_code === "string" ? body.user_code : null,
    grantId: typeof body.grantId === "string" ? body.grantId : null,
    raw: body,
  };
}

export type GrantStatus = "pending" | "approved" | "denied" | "expired" | "unknown";

/** Poll a grant until it leaves "pending" (device approval is human-paced). */
export async function pollGrantStatus(
  configuration: AgentConfiguration,
  grantId: string,
  options: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<GrantStatus> {
  const intervalMs = options.intervalMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 10 * 60_000;
  const url = endpoint(configuration, "grant_status", `/api/auth/agent/grants/${grantId}`);
  const started = Date.now();
  for (;;) {
    const res = await fetch(url);
    if (res.ok) {
      const body = (await res.json()) as Record<string, unknown>;
      const s = body.status;
      if (s === "approved" || s === "denied" || s === "expired") return s;
    }
    if (Date.now() - started > timeoutMs) return "unknown";
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
