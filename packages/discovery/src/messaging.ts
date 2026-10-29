/**
 * x402m discovery + content-profile negotiation.
 *
 * Delivery is not intelligibility: the mailbox spec answers "did the bytes
 * arrive, from an authenticated agent?" — content profiles answer "will
 * the recipient understand what the quote MEANS?" Services advertise
 * `contentProfiles` in their discovery descriptor; envelopes name the
 * profile they use (`<name>/v<major>`); a recipient that cannot interpret
 * one replies with a typed `unsupported_profile` refusal instead of
 * silently misreading an offer. (Reserved upstream in spec commit 022e006,
 * x402-foundation PR #3944.)
 */

export interface MessagingDescriptor {
  /** Mailbox execute endpoint base. */
  endpoint: string;
  /** Agent directory URL for this messaging service. */
  directory?: string;
  deliveryGuarantee?: string;
  retention?: string;
  federation?: boolean;
  capabilities?: string[];
  authProfiles?: string[];
  /** Content profile identifiers this service's agents accept. Absent = none. */
  contentProfiles: string[];
  raw: unknown;
}

export async function getMessagingDescriptor(
  baseUrl: string,
): Promise<MessagingDescriptor> {
  const base = baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/.well-known/x402m`);
  if (!res.ok) throw new Error(`x402m discovery failed: HTTP ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    endpoint: str(body.endpoint) ?? str(body.execute_endpoint) ?? base,
    directory: str(body.directory),
    deliveryGuarantee: str(body.deliveryGuarantee) ?? str(body.delivery_guarantee),
    retention: str(body.retention),
    federation: typeof body.federation === "boolean" ? body.federation : undefined,
    capabilities: Array.isArray(body.capabilities) ? (body.capabilities as string[]) : undefined,
    authProfiles: Array.isArray(body.authProfiles) ? (body.authProfiles as string[]) : undefined,
    contentProfiles: Array.isArray(body.contentProfiles)
      ? (body.contentProfiles as string[])
      : [],
    raw: body,
  };
}

/** Parse `<name>/v<major>` — names may be short names or absolute URIs. */
export function parseContentProfile(id: string): { name: string; major: number } | null {
  const m = /^(.+)\/v(\d+)$/.exec(id);
  if (!m) return null;
  return { name: m[1] as string, major: Number(m[2]) };
}

export function isProfileSupported(descriptor: MessagingDescriptor, profile: string): boolean {
  return descriptor.contentProfiles.includes(profile);
}

export type ProfileNegotiation =
  | { supported: true; profile: string }
  | {
      supported: false;
      code: "unsupported_profile";
      profile: string;
      /** Profiles the counterparty DOES accept (the wire reply calls this `supported`). */
      supportedProfiles: string[];
      /** Same name, highest major the other side offers — a hint, never a silent downgrade. */
      closest: string | null;
    };

/**
 * Decide whether `profile` can be used with a counterparty descriptor.
 * Fail closed on major-version mismatch; never downgrade silently.
 */
export function negotiateContentProfile(
  descriptor: MessagingDescriptor,
  profile: string,
): ProfileNegotiation {
  if (isProfileSupported(descriptor, profile)) {
    return { supported: true, profile };
  }
  const wanted = parseContentProfile(profile);
  let closest: string | null = null;
  if (wanted) {
    const sameName = descriptor.contentProfiles
      .map((id) => ({ id, parsed: parseContentProfile(id) }))
      .filter((x) => x.parsed && x.parsed.name === wanted.name)
      .sort((a, b) => (b.parsed?.major ?? 0) - (a.parsed?.major ?? 0));
    closest = sameName[0]?.id ?? null;
  }
  return {
    supported: false,
    code: "unsupported_profile",
    profile,
    supportedProfiles: descriptor.contentProfiles,
    closest,
  };
}

/** Build the wire shape of an unsupported_profile error reply (kind: "error"). */
export function unsupportedProfileReply(profile: string, supported: string[]): {
  code: "unsupported_profile";
  profile: string;
  supported: string[];
} {
  return { code: "unsupported_profile", profile, supported };
}
