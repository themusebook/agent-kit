/**
 * EIP-8004 registration document (the "registration-v1" JSON pinned to IPFS
 * and bound onchain by the Metaplex Agent Identity record).
 * Template source: IDENTITY.md §9. Only advertise services and trust modes
 * the agent actually supports — metadata is a declaration; verification
 * determines whether it is credible.
 */

export const REGISTRATION_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

export const METAPLEX_REGISTRY = "solana:101:metaplex";

export const SUPPORTED_TRUST_MODES = [
  "reputation",
  "crypto-economic",
  "tee-attestation",
] as const;
export type SupportedTrustMode = (typeof SUPPORTED_TRUST_MODES)[number];

export interface RegistrationService {
  name: string;
  endpoint: string;
  /** Service version string, when the service versions its surface. */
  version?: string;
  /** Skill slugs (themusebook/skills) this service exposes or consumes. */
  skills?: string[];
  /** Domains / verticals this service operates in (e.g. "rwa", "defi"). */
  domains?: string[];
}

export interface RegistrationRef {
  agentId: string;
  agentRegistry: string;
}

export interface RegistrationDocument {
  type: string;
  name: string;
  description: string;
  image: string;
  services: RegistrationService[];
  active: boolean;
  /** True when the agent accepts x402 payments (see payments modes). */
  x402Support: boolean;
  registrations: RegistrationRef[];
  supportedTrust: string[];
}

export interface RegistrationDocumentInput {
  name: string;
  description: string;
  /**
   * Permanent URI for the agent image — ipfs://, ar://, or an Irys/Arweave
   * gateway URL. Ephemeral hosts break identity.
   */
  image: string;
  services?: RegistrationService[];
  supportedTrust?: SupportedTrustMode[];
  /** Filled after mint: the MPL Core asset address. May be empty pre-mint. */
  agentId?: string;
  active?: boolean;
  x402Support?: boolean;
}

export function buildRegistrationDocument(
  input: RegistrationDocumentInput,
): RegistrationDocument {
  return {
    type: REGISTRATION_TYPE,
    name: input.name,
    description: input.description,
    image: input.image,
    services: input.services ?? [],
    active: input.active ?? true,
    x402Support: input.x402Support ?? false,
    registrations: [
      { agentId: input.agentId ?? "", agentRegistry: METAPLEX_REGISTRY },
    ],
    supportedTrust: input.supportedTrust ?? ["reputation"],
  };
}

/** Returns a list of problems; empty array means the document is valid. */
export function validateRegistrationDocument(doc: unknown): string[] {
  const problems: string[] = [];
  if (typeof doc !== "object" || doc === null) {
    return ["document must be an object"];
  }
  const d = doc as Partial<RegistrationDocument>;
  if (d.type !== REGISTRATION_TYPE) {
    problems.push(`type must be "${REGISTRATION_TYPE}"`);
  }
  if (!d.name || typeof d.name !== "string") problems.push("name is required");
  if (!d.description || typeof d.description !== "string") {
    problems.push("description is required");
  }
  if (!d.image || typeof d.image !== "string") {
    problems.push("image is required");
  } else if (!isPermanentUri(d.image)) {
    problems.push(
      "image must be a permanent URI (ipfs://, ar://, or an Irys/Arweave gateway URL)",
    );
  }
  if (!Array.isArray(d.services)) {
    problems.push("services must be an array");
  } else {
    for (const s of d.services) {
      if (!s?.name || !s?.endpoint) {
        problems.push("every service needs a name and an endpoint");
        break;
      }
      if (s.version !== undefined && typeof s.version !== "string") {
        problems.push("service version must be a string");
        break;
      }
      if (
        (s.skills !== undefined && !isStringArray(s.skills)) ||
        (s.domains !== undefined && !isStringArray(s.domains))
      ) {
        problems.push("service skills/domains must be string arrays");
        break;
      }
    }
  }
  if (typeof d.active !== "boolean") problems.push("active must be a boolean");
  if (typeof d.x402Support !== "boolean") {
    problems.push("x402Support must be a boolean");
  }
  if (!Array.isArray(d.registrations) || d.registrations.length === 0) {
    problems.push("registrations must be a non-empty array");
  } else {
    for (const r of d.registrations) {
      if (r?.agentRegistry !== METAPLEX_REGISTRY) {
        problems.push(`registrations[].agentRegistry must be "${METAPLEX_REGISTRY}"`);
        break;
      }
    }
  }
  if (!Array.isArray(d.supportedTrust)) {
    problems.push("supportedTrust must be an array");
  } else {
    for (const t of d.supportedTrust) {
      if (!(SUPPORTED_TRUST_MODES as readonly string[]).includes(t)) {
        problems.push(`unsupported trust mode: ${t}`);
      }
    }
  }
  return problems;
}

export function isValidRegistrationDocument(doc: unknown): boolean {
  return validateRegistrationDocument(doc).length === 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Permanent content URIs: ipfs://, ar://, or an Irys/Arweave gateway URL.
 * Anything else (a random https host) can rot or be swapped — identity
 * documents must not point at it. (The owner's RWA stack uses Irys gateway
 * URLs for token images; the registration image follows the same rule.)
 */
export function isPermanentUri(uri: string): boolean {
  if (uri.startsWith("ipfs://") || uri.startsWith("ar://")) return true;
  return /^https:\/\/(gateway\.irys\.xyz|arweave\.net|[\w-]+\.arweave\.net)\//.test(uri);
}

/** Convert an ipfs:// URI (or bare CID) to an HTTP gateway URL for reads. */
export function ipfsToHttp(uri: string, gateway = "https://gateway.pinata.cloud/ipfs"): string {
  if (uri.startsWith("ipfs://")) return `${gateway}/${uri.slice("ipfs://".length)}`;
  if (/^[a-zA-Z0-9]{32,}$/.test(uri)) return `${gateway}/${uri}`;
  return uri;
}

// ---------------------------------------------------------------------------
// Hosted-API agentMetadata — a DIFFERENT object from the registration
// document above. The mint call carries two distinct metadata fields
// (Metaplex "Mint an Agent" docs):
//
//   uri           → stored ONCHAIN in the Core asset's metadata; a publicly
//                   accessible JSON URL (the asset's NFT metadata).
//   agentMetadata → stored OFF-CHAIN by the Metaplex API alongside the
//                   agent record; describes capabilities, services and the
//                   trust model; indexed by the registry for discovery.
//
// Do not conflate them: the EIP-8004 registration document (top of this
// file) is what the Agent Identity registration URI points at; the object
// below is the hosted API's own record shape.
// ---------------------------------------------------------------------------

/** Networks the Metaplex hosted API accepts in the mint input. */
export const METAPLEX_NETWORKS = [
  "solana-mainnet",
  "solana-devnet",
  "localnet",
  "eclipse-mainnet",
  "sonic-mainnet",
  "sonic-devnet",
  "fogo-mainnet",
  "fogo-testnet",
] as const;
export type MetaplexNetwork = (typeof METAPLEX_NETWORKS)[number];

/** Map the kit's coarse network switch onto a hosted-API network value. */
export function toMetaplexNetwork(
  network?: "devnet" | "mainnet-beta",
): MetaplexNetwork {
  return network === "devnet" ? "solana-devnet" : "solana-mainnet";
}

export interface AgentMetadataService {
  /** Service type — e.g. 'trading', 'chat', 'MCP', 'A2A'. */
  name: string;
  /** URL where the service can be reached. */
  endpoint: string;
}

export interface AgentMetadataRegistration {
  agentId: string;
  agentRegistry: string;
}

/**
 * Off-chain agent record sent to the hosted API as `agentMetadata`.
 * `type`, `name` and `description` are required by the API; the rest are
 * optional. `supportedTrust` entries are free-form strings on the API side
 * (documented examples: 'reputation', 'tee') — unlike the registration
 * document's fixed trust-mode list above.
 */
export interface AgentMetadata {
  type: "agent";
  name: string;
  description: string;
  services: AgentMetadataService[];
  registrations: AgentMetadataRegistration[];
  supportedTrust: string[];
}

export type AgentMetadataInput = Omit<
  AgentMetadata,
  "type" | "services" | "registrations" | "supportedTrust"
> & {
  services?: AgentMetadataService[];
  registrations?: AgentMetadataRegistration[];
  supportedTrust?: string[];
};

export function buildAgentMetadata(input: AgentMetadataInput): AgentMetadata {
  return {
    type: "agent",
    name: input.name,
    description: input.description,
    services: input.services ?? [],
    registrations: input.registrations ?? [],
    supportedTrust: input.supportedTrust ?? [],
  };
}

/** Returns a list of problems; empty array means the metadata is valid. */
export function validateAgentMetadata(meta: unknown): string[] {
  const problems: string[] = [];
  if (typeof meta !== "object" || meta === null) {
    return ["agentMetadata must be an object"];
  }
  const m = meta as Partial<AgentMetadata>;
  if (m.type !== "agent") problems.push('agentMetadata.type must be "agent"');
  if (!m.name || typeof m.name !== "string") {
    problems.push("agentMetadata.name is required");
  }
  if (!m.description || typeof m.description !== "string") {
    problems.push("agentMetadata.description is required");
  }
  if (m.services !== undefined) {
    if (!Array.isArray(m.services)) {
      problems.push("agentMetadata.services must be an array");
    } else {
      for (const s of m.services) {
        if (!s?.name || !s?.endpoint) {
          problems.push("every agentMetadata service needs a name and an endpoint");
          break;
        }
      }
    }
  }
  if (m.registrations !== undefined && !Array.isArray(m.registrations)) {
    problems.push("agentMetadata.registrations must be an array");
  }
  if (m.supportedTrust !== undefined && !isStringArray(m.supportedTrust)) {
    problems.push("agentMetadata.supportedTrust must be a string array");
  }
  return problems;
}
