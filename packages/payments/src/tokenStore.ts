/**
 * Auth-token storage for x402 agent flows (notably the Mech delegated
 * mode, whose auth tokens live ~24h). The store is an interface on
 * purpose: where a bearer token sleeps is a security decision the kit
 * must not make silently.
 */

export interface AuthTokenStore {
  get(): Promise<string | null>;
  set(token: string, ttlMs?: number): Promise<void>;
  clear(): Promise<void>;
}

/** Documented Mech auth-token lifetime: 24 hours. */
export const AUTH_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Default store: memory only. The token dies with the process. */
export class InMemoryAuthTokenStore implements AuthTokenStore {
  private token: string | null = null;
  private expiresAt = 0;

  async get(): Promise<string | null> {
    if (this.token === null) return null;
    if (Date.now() > this.expiresAt) {
      this.token = null;
      return null;
    }
    return this.token;
  }

  async set(token: string, ttlMs: number = AUTH_TOKEN_TTL_MS): Promise<void> {
    this.token = token;
    this.expiresAt = Date.now() + ttlMs;
  }

  async clear(): Promise<void> {
    this.token = null;
    this.expiresAt = 0;
  }
}

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Browser localStorage-backed store.
 *
 * ⚠️ XSS WARNING: localStorage is readable by EVERY script running on
 * the origin. A single injected script (a compromised dependency, a
 * stored-XSS bug anywhere on the page) can exfiltrate a 24h bearer
 * token and spend as the agent until it expires or is revoked. Prefer
 * InMemoryAuthTokenStore; use this variant only when the token must
 * survive reloads AND the origin's script surface is fully trusted.
 */
export class LocalStorageAuthTokenStore implements AuthTokenStore {
  constructor(
    private readonly storage: LocalStorageLike,
    private readonly key = "agent-kit:x402:auth-token",
  ) {}

  async get(): Promise<string | null> {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    try {
      const { token, expiresAt } = JSON.parse(raw) as {
        token: string;
        expiresAt: number;
      };
      if (Date.now() > expiresAt) {
        this.storage.removeItem(this.key);
        return null;
      }
      return token;
    } catch {
      this.storage.removeItem(this.key);
      return null;
    }
  }

  async set(token: string, ttlMs: number = AUTH_TOKEN_TTL_MS): Promise<void> {
    this.storage.setItem(
      this.key,
      JSON.stringify({ token, expiresAt: Date.now() + ttlMs }),
    );
  }

  async clear(): Promise<void> {
    this.storage.removeItem(this.key);
  }
}
