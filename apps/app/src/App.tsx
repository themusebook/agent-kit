import { useEffect, useState, type ReactNode } from "react";
import type { DirectorySnapshot } from "@musebook/discovery";
import type { ResolvedAgent } from "@musebook/identity";
import { filterAgents, inboxStatus, type Api, type Health, type Routine, type X402mSummary } from "./api";
import { mintWithWallet, readIdentity, registrationDraft, rpcUrl } from "./actions";
import { findProvider } from "./wallet";

export const TABS = ["Directory", "Messaging", "Jobs", "Identity", "Mint"] as const;
export type Tab = (typeof TABS)[number];

function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    load().then((data) => live && setState({ data, loading: false }), (e: Error) => live && setState({ error: e.message, loading: false }));
    return () => { live = false; };
  }, deps);
  return state;
}

function Status({ state, children }: { state: { error?: string; loading: boolean }; children: ReactNode }) {
  if (state.loading) return <p className="note">Loading…</p>;
  if (state.error) return <p className="error">{state.error}</p>;
  return <>{children}</>;
}

export function DirectoryView({ snapshot, query }: { snapshot: DirectorySnapshot; query: string }) {
  const agents = filterAgents(snapshot, query);
  return (
    <>
      <p className="note">{agents.length} of {snapshot.totalAgents ?? snapshot.agents.length} agents from musebook.trade/agents</p>
      <table><thead><tr><th>Name</th><th>Asset</th><th>Network</th></tr></thead>
        <tbody>{agents.slice(0, 200).map((a) => (
          <tr key={a.id}><td>{a.name ?? "—"}</td><td><code>{a.assetId ?? a.id}</code></td><td>{a.network ?? "—"}</td></tr>
        ))}</tbody></table>
    </>
  );
}

export function MessagingView({ x402m, routines }: { x402m: X402mSummary; routines: Routine[] }) {
  const inbox = inboxStatus(routines);
  return (
    <>
      <h3>x402m discovery</h3>
      <p>Endpoint: <code>{x402m.endpoint ?? "not advertised"}</code></p>
      <p>Capabilities: {x402m.capabilities.join(", ") || "none listed"}</p>
      <p>Content profiles: {x402m.contentProfiles.map((p) => `${p.name}${p.major !== null ? ` v${p.major}` : ""}`).join(", ") || "none"}</p>
      <h3>Inbox status</h3>
      {inbox.length === 0 ? <p className="note">No x402m inbox-poll jobs yet. Add one on the server (kind x402m.inbox-poll).</p> : (
        <table><tbody>{inbox.map((i) => <tr key={i.agentId}><td>{i.agentId}</td><td>{i.lastStatus}</td></tr>)}</tbody></table>
      )}
    </>
  );
}

export function JobsView({ routines }: { routines: Routine[] }) {
  if (routines.length === 0) return <p className="note">No scheduled jobs.</p>;
  return (
    <table><thead><tr><th>Agent</th><th>Kind</th><th>Every</th><th>Next run</th><th>Last</th></tr></thead>
      <tbody>{routines.map((r) => (
        <tr key={r.id}><td>{r.agentId}</td><td>{r.kind}</td><td>{r.intervalSeconds}s</td>
          <td>{new Date(r.nextRunAt).toLocaleString()}</td><td>{r.lastStatus ?? "—"}</td></tr>
      ))}</tbody></table>
  );
}

export function IdentityCard({ agent }: { agent: ResolvedAgent }) {
  return (
    <dl>
      <dt>Asset</dt><dd><code>{agent.assetAddress}</code></dd>
      <dt>Exists</dt><dd>{agent.exists ? "yes" : "no"}</dd>
      <dt>Agent identity</dt><dd>{agent.isAgent ? "yes (Agent Identity binding)" : "no binding"}</dd>
      <dt>Owner</dt><dd><code>{agent.owner ?? "—"}</code></dd>
      <dt>Asset Signer PDA</dt><dd><code>{agent.assetSigner}</code></dd>
      <dt>Registration</dt><dd><code>{agent.registrationUri ?? "—"}</code></dd>
    </dl>
  );
}

function IdentityView() {
  const [asset, setAsset] = useState("");
  const [result, setResult] = useState<{ agent?: ResolvedAgent; error?: string }>({});
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); readIdentity(rpcUrl(location.origin), asset.trim()).then((agent) => setResult({ agent }), (err: Error) => setResult({ error: err.message })); }}>
        <input placeholder="MPL Core asset address" value={asset} onChange={(e) => setAsset(e.target.value)} /> <button>Read</button>
      </form>
      {result.error && <p className="error">{result.error}</p>}
      {result.agent && <IdentityCard agent={result.agent} />}
    </>
  );
}

function MintView({ network }: { network: "devnet" | "mainnet-beta" }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [image, setImage] = useState(""); const [uri, setUri] = useState(""); const [msg, setMsg] = useState("");
  const draft = name ? registrationDraft(name, description, image) : null;
  const provider = typeof window === "undefined" ? null : findProvider(window);
  return (
    <>
      <p className="note">Mint builds an unsigned transaction and asks your wallet to sign it. This app holds no keys and never signs. Network: {network}.</p>
      <input placeholder="Agent name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
      <input placeholder="Image (ipfs://…)" value={image} onChange={(e) => setImage(e.target.value)} />
      {draft && <><p>Registration document to pin{draft.errors.length ? ` (${draft.errors.join("; ")})` : ""}:</p><pre><code>{JSON.stringify(draft.doc, null, 2)}</code></pre></>}
      <input placeholder="Pinned registration URI (ipfs://…)" value={uri} onChange={(e) => setUri(e.target.value)} />
      <button disabled={!provider || !name || !uri} onClick={() => provider && mintWithWallet(provider, rpcUrl(location.origin), network, name, uri)
        .then((r) => setMsg(`Signed in your wallet: ${r.signature}`), (e: Error) => setMsg(e.message))}>
        {provider ? "Sign mint in wallet" : "No wallet found"}
      </button>
      {!provider && <button onClick={() => window.open(location.href, "_blank", "noopener")}>Open in browser to sign</button>}
      {msg && <p>{msg}</p>}
      <p className="note">Directory registration (SIWS) and payments: use <code>musebook register</code> / <code>musebook pay</code> from packages/cli for now.</p>
    </>
  );
}

export function App({ api, initialTab = "Directory", network = (import.meta.env?.VITE_NETWORK as "devnet" | "mainnet-beta") || "devnet" }:
  { api: Api; initialTab?: Tab; network?: "devnet" | "mainnet-beta" }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const health = useLoad<Health>(api.health);
  const directory = useLoad(api.directory);
  const x402m = useLoad(api.x402m);
  const routines = useLoad(api.routines);
  return (
    <>
      <header><h1>musebook agent-kit</h1>
        <span className="note">{health.data ? `server ok · ${health.data.database} · ${health.data.musebook}` : health.error ? `server: ${health.error}` : "…"}</span>
      </header>
      <nav>{TABS.map((t) => <button key={t} aria-current={t === tab ? "page" : undefined} onClick={() => setTab(t)}>{t}</button>)}</nav>
      <main>
        {tab === "Directory" && <><input placeholder="Search agents" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Status state={directory}>{directory.data && <DirectoryView snapshot={directory.data} query={query} />}</Status></>}
        {tab === "Messaging" && <Status state={x402m}>{x402m.data && <MessagingView x402m={x402m.data} routines={routines.data ?? []} />}</Status>}
        {tab === "Jobs" && <Status state={routines}>{routines.data && <JobsView routines={routines.data} />}</Status>}
        {tab === "Identity" && <IdentityView />}
        {tab === "Mint" && <MintView network={network} />}
      </main>
    </>
  );
}
