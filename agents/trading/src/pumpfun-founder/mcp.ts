import type { FetchLike } from "../http.ts";

export const DEFAULT_PUMPAI_MCP_URL = "https://pumpai.ai/mcp";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}

export interface ToolPolicy {
  exposed: McpTool[];
  disabled: { name: string; reason: string }[];
}

const WRITE_VERBS = /^(create|launch|buy|sell|trade|swap|pay|sign|send|transfer|claim|deploy|mint|withdraw|deposit|order|place|cancel|set|update|delete|post)$/i;

/**
 * Expose a tool only if the server marks it readOnlyHint and its name does
 * not start with a write verb. Anything else is disabled: the kit has no
 * path to route a remote tool's write through the user's wallet.
 */
export function classifyTools(tools: McpTool[]): ToolPolicy {
  const exposed: McpTool[] = [];
  const disabled: { name: string; reason: string }[] = [];
  for (const t of tools) {
    if (t.annotations?.readOnlyHint !== true) disabled.push({ name: t.name, reason: "not annotated readOnlyHint" });
    else if (WRITE_VERBS.test(t.name.split(/[_\-.]/)[0] ?? "")) disabled.push({ name: t.name, reason: "name starts with a write verb" });
    else exposed.push(t);
  }
  return { exposed, disabled };
}

/** Streamable-HTTP MCP client (JSON responses; SSE bodies are parsed for the first data event). No auth is sent. */
export class PumpAiMcp {
  readonly url: string;
  private session: string | null = null;
  private id = 0;
  private policy: ToolPolicy | null = null;

  constructor(opts: { url?: string; fetch?: FetchLike } = {}, private readonly f: FetchLike = opts.fetch ?? fetch) {
    this.url = opts.url ?? process.env.PUMPAI_MCP_URL ?? DEFAULT_PUMPAI_MCP_URL;
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.session) headers["mcp-session-id"] = this.session;
    const res = await this.f(this.url, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, ...(params ? { params } : {}) }) });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.session = sid;
    if (res.status === 401 || res.status === 403) throw new Error(`MCP ${this.url} requires auth (${res.status}); none is configured`);
    if (!res.ok) throw new Error(`MCP ${method}: HTTP ${res.status}`);
    const text = await res.text();
    const json = (res.headers.get("content-type") ?? "").includes("text/event-stream")
      ? JSON.parse(text.split("\n").find((l) => l.startsWith("data:"))?.slice(5) ?? "null")
      : JSON.parse(text);
    if (json?.error) throw new Error(`MCP ${method}: ${json.error.message ?? JSON.stringify(json.error)}`);
    return json?.result;
  }

  async initialize() {
    return this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "musebook-pumpfun-founder", version: "0.1.0" } });
  }

  async tools(): Promise<ToolPolicy> {
    if (!this.session) await this.initialize();
    const r = await this.rpc("tools/list");
    this.policy = classifyTools(r?.tools ?? []);
    return this.policy;
  }

  /** Calls only a tool the policy exposed as read-only. */
  async callReadTool(name: string, args: Record<string, unknown> = {}) {
    const p = this.policy ?? (await this.tools());
    if (!p.exposed.some((t) => t.name === name)) {
      const why = p.disabled.find((d) => d.name === name)?.reason ?? "not listed by the server";
      throw new Error(`MCP tool ${name} is disabled: ${why}`);
    }
    return this.rpc("tools/call", { name, arguments: args });
  }
}
