/**
 * Bearer-token storage for the Clawd A2A relay.
 *
 * TOKEN DISCIPLINE (read before wiring any other store):
 * - The relay shows a registration token EXACTLY ONCE. If it is lost,
 *   the handle cannot be recovered — register a new handle.
 * - A token is a credential. NEVER log it, never put it in prompts,
 *   model context, screenshots, URLs, or telemetry, and never commit
 *   it to a repository.
 * - This package NEVER persists a token by default. The default store
 *   is memory-only: the token dies with the process.
 * - Persistence is the CALLER's explicit choice: implement
 *   `A2ATokenStore` against your own secret storage (vault, OS
 *   keychain, 0600 file) and pass it to `createA2AClient`. Mirrors the
 *   x402 24h-token-store pattern in @musebook/payments —
 *   where a bearer secret sleeps is a security decision the kit must
 *   not make silently.
 */

export interface A2ATokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

/** Default store: memory only. The token dies with the process. */
export class InMemoryA2ATokenStore implements A2ATokenStore {
  private token: string | null = null;

  async get(): Promise<string | null> {
    return this.token;
  }

  async set(token: string): Promise<void> {
    this.token = token;
  }

  async clear(): Promise<void> {
    this.token = null;
  }
}
