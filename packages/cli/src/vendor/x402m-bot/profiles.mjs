// Content profiles (informative, mirrors the x402-foundation agent-messaging draft).
// A profile is `<name>/v<major>`. Services advertise `contentProfiles` in discovery;
// senders MUST NOT send `contentProfile` to a service that does not list it.
// Profiles never change the payment boundary: quotes are non-binding proposals.
export const PROFILE_RE = /^[a-z][a-z0-9.-]{0,62}\/v(0|[1-9][0-9]{0,5})$/;
export const PROFILE_MAX = 72;
export function isProfile(p) { return typeof p === 'string' && p.length <= PROFILE_MAX && PROFILE_RE.test(p); }
export function parseProfile(p) {
  if (!isProfile(p)) throw new Error('contentProfile must be <name>/v<major>');
  const i = p.lastIndexOf('/v');
  return { name: p.slice(0, i), major: Number(p.slice(i + 2)) };
}
export function advertisedProfiles(descriptor) {
  const list = descriptor?.contentProfiles;
  return Array.isArray(list) ? list.filter(isProfile) : [];
}
// null when accepted; otherwise the reserved `unsupported_profile` error body.
export function checkContentProfile(profile, supported) {
  if (isProfile(profile) && supported.includes(profile)) return null;
  return { code: 'unsupported_profile', profile: String(profile), supported: [...supported] };
}
export class UnsupportedProfileError extends Error {
  constructor(body) { super(`unsupported_profile: ${body.profile} (supported: ${body.supported.join(', ') || 'none'})`); Object.assign(this, body); this.name = 'UnsupportedProfileError'; }
}
// Draft x402m.offer/v1 quote check (receiver side). Not advertised by musebook.trade.
// quote = { amount: decimal string, unit: CAIP-19 asset id, expiresAt: unix seconds }.
export function checkOfferQuote(quote, { now, unit }) {
  if (!quote || typeof quote.amount !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(quote.amount) || typeof quote.unit !== 'string' || !Number.isSafeInteger(quote.expiresAt)) return { code: 'invalid_quote' };
  if (now >= quote.expiresAt) return { code: 'expired_quote', expiresAt: quote.expiresAt };
  if (unit !== undefined && quote.unit !== unit) return { code: 'unit_mismatch', expected: unit, received: quote.unit };
  return null;
}
