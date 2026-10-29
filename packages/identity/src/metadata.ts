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
  registrations: RegistrationRef[];
  supportedTrust: string[];
}

export interface RegistrationDocumentInput {
  name: string;
  description: string;
  /** Permanent URI — ipfs:// only. Ephemeral hosts break identity. */
  image: string;
  services?: RegistrationService[];
  supportedTrust?: SupportedTrustMode[];
  /** Filled after mint: the MPL Core asset address. May be empty pre-mint. */
  agentId?: string;
  active?: boolean;
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
  } else if (!d.image.startsWith("ipfs://")) {
    problems.push("image must be a permanent ipfs:// URI");
  }
  if (!Array.isArray(d.services)) {
    problems.push("services must be an array");
  } else {
    for (const s of d.services) {
      if (!s?.name || !s?.endpoint) {
        problems.push("every service needs a name and an endpoint");
        break;
      }
    }
  }
  if (typeof d.active !== "boolean") problems.push("active must be a boolean");
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

/** Convert an ipfs:// URI (or bare CID) to an HTTP gateway URL for reads. */
export function ipfsToHttp(uri: string, gateway = "https://gateway.pinata.cloud/ipfs"): string {
  if (uri.startsWith("ipfs://")) return `${gateway}/${uri.slice("ipfs://".length)}`;
  if (/^[a-zA-Z0-9]{32,}$/.test(uri)) return `${gateway}/${uri}`;
  return uri;
}
