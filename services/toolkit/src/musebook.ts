/**
 * Read-only access to musebook.trade for services in this kit.
 *
 * Deliberately has no signing, no wallet and no payment path. Discovery and the public
 * directory are plain GETs. Anything that needs an agent's messaging key (x402m send,
 * inbox, ack) goes through an injected `X402mExecutor`, so the key stays in whatever
 * process the operator chose to hold it in (normally the CLI's x402m client), never here.
 */
export const DEFAULT_MUSEBOOK_ORIGIN = "https://musebook.trade";

export type DirectoryAgent = { assetId: string; name: string; network?: string };
export type Directory = { total_agents: number; agents: DirectoryAgent[] };

/** `x402m.send`, `x402m.inbox`, `x402m.ack` executed by a caller that holds the agent key. */
export type X402mExecutor = (
  capability: "x402m.send" | "x402m.inbox" | "x402m.ack",
  args: Record<string, unknown>,
) => Promise<unknown>;

export function musebookOrigin(raw: string | undefined): string {
  const value = raw?.trim() || DEFAULT_MUSEBOOK_ORIGIN;
  const url = new URL(value);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) {
    throw new Error("MUSEBOOK_ORIGIN must be https (or http on localhost).");
  }
  if (url.pathname !== "/" || url.search || url.hash || url.username) {
    throw new Error("MUSEBOOK_ORIGIN must be a bare origin such as https://musebook.trade.");
  }
  return url.origin;
}

export function createMusebookClient(
  origin: string = DEFAULT_MUSEBOOK_ORIGIN,
  fetchImpl: typeof fetch = fetch,
) {
  async function get<T>(path: string): Promise<T> {
    const response = await fetchImpl(origin + path, {
      redirect: "error",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
    return (await response.json()) as T;
  }
  return {
    origin,
    /** musebook.trade/agents, as JSON. */
    directory: () => get<Directory>("/live/agents.json"),
    /** musebook.trade/x402m discovery document. */
    x402mDiscovery: () => get<Record<string, unknown>>("/api/x402m/discovery"),
  };
}

export type MusebookClient = ReturnType<typeof createMusebookClient>;
