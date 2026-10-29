import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { DirectorySnapshot } from "@musebook/discovery";
import type { ResolvedAgent } from "@musebook/identity";
import { createApi, filterAgents, inboxStatus, type Api, type Routine, type X402mSummary } from "./api";
import { mintWithWallet, readIdentity, registrationDraft } from "./actions";
import { normalizeDashboardUrl, rpcUrl, serverBase } from "./config";
import { chainFor, connect, type MwaSession, type Transact } from "./mwa";

export const TABS = ["Directory", "Messaging", "Jobs", "Identity", "Mint"] as const;
type Tab = (typeof TABS)[number];
const NETWORK: "devnet" | "mainnet-beta" = process.env.EXPO_PUBLIC_SOLANA_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";
const mwa = transact as unknown as Transact;

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [s, set] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    set({ loading: true });
    load().then((data) => live && set({ data, loading: false }), (e: Error) => live && set({ error: e.message, loading: false }));
    return () => { live = false; };
  }, deps);
  return s;
}

const Note = ({ children }: { children: ReactNode }) => <Text style={st.note}>{children}</Text>;
const Btn = ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => (
  <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[st.btn, disabled && { opacity: 0.4 }]}><Text style={st.btnText}>{title}</Text></Pressable>
);
function Status({ s, children }: { s: { error?: string; loading: boolean }; children: ReactNode }) {
  if (s.loading) return <Note>Loading…</Note>;
  if (s.error) return <Text style={st.error}>{s.error}</Text>;
  return <>{children}</>;
}

function Directory({ api }: { api: Api }) {
  const [q, setQ] = useState("");
  const s = useLoad<DirectorySnapshot>(api.directory, [api]);
  const agents = s.data ? filterAgents(s.data, q) : [];
  return <Status s={s}>{s.data && <>
    <TextInput style={st.input} placeholder="Search agents" placeholderTextColor="#888" value={q} onChangeText={setQ} />
    <Note>{agents.length} of {s.data.totalAgents ?? s.data.agents.length} agents from musebook.trade/agents</Note>
    {agents.slice(0, 200).map((a) => <View key={a.id} style={st.row}><Text style={st.text}>{a.name ?? "—"}</Text><Text style={st.mono}>{a.assetId ?? a.id}</Text></View>)}
  </>}</Status>;
}

function Messaging({ api }: { api: Api }) {
  const s = useLoad<[X402mSummary, Routine[]]>(() => Promise.all([api.x402m(), api.routines()]), [api]);
  return <Status s={s}>{s.data && <>
    <Text style={st.h}>x402m discovery</Text>
    <Text style={st.text}>Endpoint: {s.data[0].endpoint ?? "not advertised"}</Text>
    <Text style={st.text}>Capabilities: {s.data[0].capabilities.join(", ") || "none listed"}</Text>
    <Text style={st.h}>Inbox status</Text>
    {inboxStatus(s.data[1]).length === 0 && <Note>No x402m inbox-poll jobs yet.</Note>}
    {inboxStatus(s.data[1]).map((i) => <Text key={i.agentId} style={st.text}>{i.agentId}: {i.lastStatus}</Text>)}
  </>}</Status>;
}

function Jobs({ api }: { api: Api }) {
  const s = useLoad(api.routines, [api]);
  return <Status s={s}>{s.data && (s.data.length === 0 ? <Note>No scheduled jobs.</Note> : s.data.map((r) => (
    <View key={r.id} style={st.row}><Text style={st.text}>{r.agentId} · {r.kind}</Text>
      <Note>every {r.intervalSeconds}s · next {new Date(r.nextRunAt).toLocaleString()} · {r.lastStatus ?? "—"}</Note></View>
  )))}</Status>;
}

function Identity({ rpc }: { rpc: string }) {
  const [asset, setAsset] = useState("");
  const [r, setR] = useState<{ agent?: ResolvedAgent; error?: string }>({});
  return <>
    <TextInput style={st.input} placeholder="MPL Core asset address" placeholderTextColor="#888" value={asset} onChangeText={setAsset} autoCapitalize="none" />
    <Btn title="Read" onPress={() => readIdentity(rpc, asset.trim()).then((agent) => setR({ agent }), (e: Error) => setR({ error: e.message }))} />
    {r.error && <Text style={st.error}>{r.error}</Text>}
    {r.agent && <>
      <Text style={st.text}>Exists: {r.agent.exists ? "yes" : "no"} · Agent identity: {r.agent.isAgent ? "yes" : "no"}</Text>
      <Text style={st.mono}>Owner {r.agent.owner ?? "—"}</Text>
      <Text style={st.mono}>Asset Signer {r.agent.assetSigner}</Text>
      <Text style={st.mono}>Registration {r.agent.registrationUri ?? "—"}</Text>
    </>}
  </>;
}

function Mint({ rpc, session, setSession }: { rpc: string; session: MwaSession | null; setSession: (s: MwaSession) => void }) {
  const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [image, setImage] = useState(""); const [uri, setUri] = useState(""); const [msg, setMsg] = useState("");
  const draft = name ? registrationDraft(name, description, image) : null;
  return <>
    <Note>Mint builds an unsigned transaction and your wallet app signs it through Mobile Wallet Adapter. This app holds no keys. Network: {NETWORK}.</Note>
    {!session && <Btn title="Connect wallet" onPress={() => connect(mwa, chainFor(NETWORK)).then(setSession, (e: Error) => setMsg(e.message))} />}
    {session && <Text style={st.mono}>Wallet {session.publicKey}</Text>}
    <TextInput style={st.input} placeholder="Agent name" placeholderTextColor="#888" value={name} onChangeText={setName} />
    <TextInput style={st.input} placeholder="Description" placeholderTextColor="#888" value={description} onChangeText={setDescription} />
    <TextInput style={st.input} placeholder="Image (ipfs://…)" placeholderTextColor="#888" value={image} onChangeText={setImage} autoCapitalize="none" />
    {draft && <Text style={st.mono}>{JSON.stringify(draft.doc, null, 2)}{draft.errors.length ? `\n(${draft.errors.join("; ")})` : ""}</Text>}
    <TextInput style={st.input} placeholder="Pinned registration URI (ipfs://…)" placeholderTextColor="#888" value={uri} onChangeText={setUri} autoCapitalize="none" />
    <Btn title="Sign mint in wallet" disabled={!session || !name || !uri}
      onPress={() => { if (session) mintWithWallet(mwa, NETWORK, session, rpc, name, uri).then((r) => setMsg(`Signed in your wallet: ${r.signature}`), (e: Error) => setMsg(e.message)); }} />
    {!!msg && <Text style={st.text}>{msg}</Text>}
  </>;
}

export default function App() {
  const [input, setInput] = useState(process.env.EXPO_PUBLIC_DASHBOARD_URL ?? "");
  const [origin, setOrigin] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<Tab>("Directory");
  const [session, setSession] = useState<MwaSession | null>(null);
  const api = useMemo(() => (origin ? createApi(serverBase(origin)) : null), [origin]);

  if (!origin || !api) {
    return <SafeAreaView style={st.root}><View style={st.pad}>
      <Text style={st.title}>musebook agents</Text>
      <TextInput style={st.input} placeholder="Dashboard URL (https://…)" placeholderTextColor="#888" value={input} onChangeText={setInput} autoCapitalize="none" keyboardType="url" />
      <Btn title="Open" onPress={() => { const r = normalizeDashboardUrl(input); if ("error" in r) setErr(r.error); else { setErr(""); setOrigin(r.origin); } }} />
      {!!err && <Text style={st.error}>{err}</Text>}
      <Note>Point this at your agent-kit dashboard. The phone holds no keys or server secrets.</Note>
    </View><StatusBar style="light" /></SafeAreaView>;
  }
  const rpc = rpcUrl(origin);
  return <SafeAreaView style={st.root}>
    <ScrollView horizontal style={st.tabs} contentContainerStyle={{ gap: 6 }}>
      {TABS.map((t) => <Pressable key={t} onPress={() => setTab(t)} style={[st.tab, t === tab && st.tabOn]}><Text style={st.btnText}>{t}</Text></Pressable>)}
    </ScrollView>
    <ScrollView contentContainerStyle={st.pad}>
      {tab === "Directory" && <Directory api={api} />}
      {tab === "Messaging" && <Messaging api={api} />}
      {tab === "Jobs" && <Jobs api={api} />}
      {tab === "Identity" && <Identity rpc={rpc} />}
      {tab === "Mint" && <Mint rpc={rpc} session={session} setSession={setSession} />}
    </ScrollView>
    <StatusBar style="light" />
  </SafeAreaView>;
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#07060b" },
  pad: { padding: 16, gap: 10 },
  title: { color: "#fff", fontSize: 24, fontWeight: "700", marginTop: 40 },
  h: { color: "#fff", fontSize: 17, fontWeight: "600", marginTop: 8 },
  text: { color: "#eee" },
  mono: { color: "#ccc", fontFamily: "monospace", fontSize: 12 },
  note: { color: "#999", fontSize: 13 },
  error: { color: "#ff6b81" },
  input: { borderWidth: 1, borderColor: "#333", borderRadius: 8, padding: 10, color: "#fff" },
  btn: { backgroundColor: "#9945ff", borderRadius: 8, padding: 12, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "600" },
  row: { borderBottomWidth: 1, borderBottomColor: "#222", paddingVertical: 8 },
  tabs: { flexGrow: 0, paddingHorizontal: 12, paddingVertical: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, backgroundColor: "#1a1825" },
  tabOn: { backgroundColor: "#9945ff" },
});
