import type { AgentConfiguration } from "@musebook/auth";

/**
 * Agent Auth provider inspection — the same read registry.musebook.trade's
 * /discover page performs: fetch a provider's agent-configuration and
 * summarize what an agent is walking into.
 */

export interface ProviderSummary {
  providerName: string | null;
  issuer: string;
  modes: string[];
  approval: string[];
  endpointCount: number;
  raw: AgentConfiguration;
}

export async function inspectProvider(providerBaseUrl: string): Promise<ProviderSummary> {
  const base = providerBaseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/agent-configuration`);
  if (!res.ok) throw new Error(`Provider discovery failed: HTTP ${res.status}`);
  const config = (await res.json()) as AgentConfiguration;
  return {
    providerName: config.provider_name ?? null,
    issuer: config.issuer,
    modes: config.modes ?? [],
    approval: config.approval ?? [],
    endpointCount: config.endpoints ? Object.keys(config.endpoints).length : 0,
    raw: config,
  };
}
