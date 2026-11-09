import type { AgentCard, Network } from "./types.js";

export interface RegisteredWebMCPTool {
  name: string;
  origin: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean; untrustedContentHint?: boolean };
}

export interface WebMCPContext {
  getTools(): Promise<RegisteredWebMCPTool[]>;
  executeTool(tool: RegisteredWebMCPTool, input: object | string, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export interface MusebookWebMCPOptions {
  /** Defaults to document.modelContext. Override only with a trusted browser context. */
  context?: WebMCPContext;
  /** Defaults to the current document origin. Useful with an injected context. */
  expectedOrigin?: string;
  /** Current Chrome uses objects; Chrome 154 and earlier previews require json-string. */
  inputEncoding?: "object" | "json-string";
}

export interface WebMCPReadInputs {
  musebook_wallet_context: Record<string, never>;
  musebook_site_launches: { network: Network; kind?: "token" | "agent"; limit?: number };
  musebook_metaplex_launches: { network: Network; status?: "upcoming" | "live" | "graduated"; spotlight?: boolean; limit?: number };
  musebook_agent_card: { network: Network; address: string };
}
export interface WebMCPReadResults {
  musebook_wallet_context: { connected: boolean; address: string | null; chain: "solana"; tradeNetwork: "mainnet"; requiresUserReview: true };
  musebook_site_launches: { network: Network; scope: "verified_site_reports"; count: number;
    items: Array<{ network: Network; kind: "token" | "agent"; asset: string; signature: string; creatorWallet: string;
      name: string | null; symbol: string | null; venue: string | null; createdAt: number }> };
  musebook_metaplex_launches: { network: Network; count: number; total: number; truncated: boolean;
    items: Array<{ genesis: string; mint: string; name: string | null; symbol: string | null; status?: string; type?: string;
      spotlight: boolean; startTime?: string; endTime?: string | null }> };
  musebook_agent_card: AgentCard;
}

const READ_TOOLS = new Set<keyof WebMCPReadInputs>([
  "musebook_wallet_context", "musebook_site_launches", "musebook_metaplex_launches", "musebook_agent_card",
]);

export class WebMCPUnavailableError extends Error {
  constructor(message = "WebMCP is unavailable. Open Musebook in a compatible browser with its page tools enabled.") {
    super(message);
    this.name = "WebMCPUnavailableError";
  }
}

/** Read-only companion to Musebook's page tools, not a remote MCP transport or wallet executor. */
export class MusebookWebMCPClient {
  constructor(private readonly options: MusebookWebMCPOptions = {}) {}

  private context(): WebMCPContext | undefined {
    const doc = typeof document === "undefined" ? undefined : document as Document & { modelContext?: WebMCPContext };
    return this.options.context ?? doc?.modelContext;
  }

  get supported(): boolean {
    const context = this.context();
    return typeof context?.getTools === "function" && typeof context.executeTool === "function";
  }

  private accepts(tool: RegisteredWebMCPTool): boolean {
    const origin = this.options.expectedOrigin ?? (typeof location === "undefined" ? undefined : location.origin);
    return READ_TOOLS.has(tool.name as keyof WebMCPReadInputs)
      && tool.annotations?.readOnlyHint === true && tool.annotations.consequentialHint !== true
      && (!origin || tool.origin === origin);
  }

  async tools(): Promise<RegisteredWebMCPTool[]> {
    const context = this.context();
    if (!context || !this.supported) throw new WebMCPUnavailableError();
    return (await context.getTools()).filter(tool => this.accepts(tool));
  }

  async call<Name extends keyof WebMCPReadInputs>(name: Name, input: WebMCPReadInputs[Name], options: { signal?: AbortSignal } = {}): Promise<WebMCPReadResults[Name] | null> {
    if (!READ_TOOLS.has(name)) throw new Error("This SDK entry point only invokes the four Musebook discovery tools.");
    options.signal?.throwIfAborted();
    const context = this.context();
    if (!context || !this.supported) throw new WebMCPUnavailableError();
    const tools = (await context.getTools()).filter(tool => tool.name === name && this.accepts(tool));
    options.signal?.throwIfAborted();
    if (tools.length !== 1) throw new WebMCPUnavailableError(`Expected one trusted ${name} tool; found ${tools.length}.`);
    const args = this.options.inputEncoding === "json-string" ? JSON.stringify(input) : input;
    // Keep the native receiver and RegisteredTool object. Never retry execution on a type error.
    const result = await context.executeTool(tools[0], args, options);
    return (typeof result === "string" ? JSON.parse(result) : result) as WebMCPReadResults[Name] | null;
  }
}
