/**
 * Metaplex Agent Registry — READ and RUN sides, built on the official SDKs
 * (@metaplex-foundation/mpl-agent-registry >= 0.2.0, mpl-core, mpl-toolbox).
 *
 * Sources (verified 2026-10-29 against the live docs and the installed
 * package types — see docs/metaplex-agent-ops.md):
 *   https://www.metaplex.com/docs/agents/read-agent-data
 *   https://www.metaplex.com/docs/agents/run-an-agent
 *
 * RUN-side builders return UNSIGNED, serialized transactions for the user's
 * own wallet to review and sign. Nothing here signs, sends, or generates a
 * keypair: every signer is a umi noop signer.
 */
import {
  createNoopSigner,
  publicKey as toPk,
  signerIdentity,
  type PublicKey as UmiPublicKey,
  type TransactionBuilder,
  type Umi,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import {
  delegateExecutionV1,
  fetchAgentIdentityV1FromSeeds,
  findAgentIdentityV1Pda,
  findExecutionDelegateRecordV1Pda,
  findExecutiveProfileV1Pda,
  mplAgentIdentity,
  mplAgentTools,
  registerExecutiveV1,
  revokeExecutionV1,
  safeFetchAgentIdentityV1,
  MPL_AGENT_IDENTITY_PROGRAM_ID,
  MPL_AGENT_TOOLS_PROGRAM_ID,
} from "@metaplex-foundation/mpl-agent-registry";
import {
  execute,
  fetchAsset,
  findAssetSignerPda,
  mplCore,
  CheckResult,
} from "@metaplex-foundation/mpl-core";
import { findAssociatedTokenPda, mplToolbox, revokeTokenDelegate } from "@metaplex-foundation/mpl-toolbox";
import { fetchRegistrationDocument } from "./resolve";
import type { RegistrationDocument } from "./metadata";

export { MPL_AGENT_IDENTITY_PROGRAM_ID, MPL_AGENT_TOOLS_PROGRAM_ID };

/** Docs callout, verbatim intent: fund the Asset Signer PDA, never the Core asset address. */
export const FUND_ASSET_SIGNER_WARNING =
  "Send funds to the Asset Signer, not the asset address. The Asset Signer PDA and the agent's Core asset are two different addresses; always fund the Asset Signer PDA.";

/** Docs "Operational authority" callout for DelegateExecutionV1. */
export const OPERATIONAL_AUTHORITY_WARNING =
  "Operational authority: an execution delegate may cause the agent's Asset Signer PDA to sign ANY instruction passed through Core's Execute hook. Delegate only to operators you trust to run the agent (see the Agent Tools security model).";

/** Docs note for RevokeExecutionV1. */
export const REVOCATION_SCOPE_NOTE =
  "Revocation closes the ExecutionDelegateRecordV1 and stops FUTURE Execute calls from this executive through the AgentIdentity path. It does not unwind state created by previous executions (SPL approvals, escrow positions, delegated authorities); undo those in the program that owns them (see cleanup-approval).";

type Key = string | UmiPublicKey;
const pk = (k: Key): UmiPublicKey => toPk(k);

/**
 * A umi with Core + Agent Identity + Agent Tools (+ mpl-toolbox, which the
 * SPL cleanup needs and umi-bundle-defaults does not register) programs.
 * No identity/payer.
 */
export function createAgentUmi(rpc: string): Umi {
  return createUmi(rpc).use(mplToolbox()).use(mplCore()).use(mplAgentIdentity()).use(mplAgentTools());
}

// ───────────────────────────── READ ─────────────────────────────

export function agentIdentityPda(umi: Umi, asset: Key): string {
  return String(findAgentIdentityV1Pda(umi, { asset: pk(asset) })[0]);
}
export function assetSignerPda(umi: Umi, asset: Key): string {
  return String(findAssetSignerPda(umi, { asset: pk(asset) })[0]);
}
export function executiveProfilePda(umi: Umi, authority: Key): string {
  return String(findExecutiveProfileV1Pda(umi, { authority: pk(authority) })[0]);
}
export function executionDelegateRecordPda(umi: Umi, executiveAuthority: Key, agentAsset: Key): string {
  const executiveProfile = findExecutiveProfileV1Pda(umi, { authority: pk(executiveAuthority) });
  return String(findExecutionDelegateRecordV1Pda(umi, { executiveProfile: executiveProfile[0], agentAsset: pk(agentAsset) })[0]);
}

/** safeFetchAgentIdentityV1: the identity account, or null when the asset is unregistered. */
export async function checkRegistration(umi: Umi, asset: Key) {
  const pda = findAgentIdentityV1Pda(umi, { asset: pk(asset) });
  const identity = await safeFetchAgentIdentityV1(umi, pda);
  return { registered: identity !== null, identityPda: String(pda[0]), identity };
}

/** fetchAgentIdentityV1FromSeeds: THROWS when the identity account does not exist. */
export function fetchIdentityFromSeeds(umi: Umi, asset: Key) {
  return fetchAgentIdentityV1FromSeeds(umi, { asset: pk(asset) });
}

export interface LifecycleHooks {
  transfer: boolean;
  update: boolean;
  execute: boolean;
}

/**
 * Normalize one lifecycle check. mpl-core 1.10 types it as CheckResult[]
 * (CAN_LISTEN = 0); the docs print `{ __kind: 'Listen' }`. Accept both.
 */
export function hookListens(v: unknown): boolean {
  if (Array.isArray(v)) return v.includes(CheckResult.CAN_LISTEN) || v.includes("Listen");
  if (v && typeof v === "object") return (v as { __kind?: string }).__kind === "Listen";
  return false;
}

export interface AgentIdentityPluginView {
  uri: string;
  lifecycleChecks: LifecycleHooks;
  rawLifecycleChecks: unknown;
}

/** Read the AgentIdentity external plugin off a fetched Core asset (agentIdentities[0]). */
export function agentIdentityPlugin(assetData: { agentIdentities?: Array<{ uri?: string; lifecycleChecks?: unknown }> }): AgentIdentityPluginView | null {
  const plugin = assetData.agentIdentities?.[0];
  if (!plugin) return null;
  const lc = (plugin.lifecycleChecks ?? {}) as Record<string, unknown>;
  return {
    uri: plugin.uri ?? "",
    lifecycleChecks: { transfer: hookListens(lc.transfer), update: hookListens(lc.update), execute: hookListens(lc.execute) },
    rawLifecycleChecks: plugin.lifecycleChecks ?? null,
  };
}

export async function readAgentIdentityPlugin(umi: Umi, asset: Key) {
  const assetData = await fetchAsset(umi, pk(asset));
  return { owner: String(assetData.owner), name: assetData.name, plugin: agentIdentityPlugin(assetData as never) };
}

/** Plugin URI → ERC-8004 registration document. Throws on non-OK HTTP (as the docs do). */
export async function readRegistrationDocument(umi: Umi, asset: Key): Promise<{ uri: string; document: RegistrationDocument; problems: string[] } | null> {
  const { plugin } = await readAgentIdentityPlugin(umi, asset);
  if (!plugin?.uri) return null;
  const r = await fetchRegistrationDocument(plugin.uri);
  return { uri: plugin.uri, ...r };
}

/** The agent's wallet: Asset Signer PDA + lamport balance, with the funding warning. */
export async function readAgentWallet(umi: Umi, asset: Key) {
  const pda = findAssetSignerPda(umi, { asset: pk(asset) });
  const balance = await umi.rpc.getBalance(pda[0]);
  return { asset: String(asset), assetSigner: String(pda[0]), lamports: balance.basisPoints.toString(), warning: FUND_ASSET_SIGNER_WARNING };
}

// ───────────────────────────── DAS ─────────────────────────────
// Responses are snake_case (is_agent, asset_signer, agent_token);
// searchAssets params are camelCase (isAgent, agentToken, assetSigner).

export interface DasAgentAsset {
  id: string;
  interface?: string;
  is_agent?: boolean;
  asset_signer?: string;
  agent_token?: string;
  ownership?: { owner?: string };
  content?: { json_uri?: string; metadata?: { name?: string } };
  grouping?: Array<{ group_key: string; group_value: string }>;
  burnt?: boolean;
  external_plugins?: Array<{ type?: string; adapter_config?: { uri?: string } }>;
  [k: string]: unknown;
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

async function das<T>(rpc: string, method: string, params: unknown, fetchImpl: FetchLike = globalThis.fetch as never): Promise<T> {
  const res = await fetchImpl(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`DAS ${method} failed: HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`DAS ${method} failed: ${j.error.message}`);
  return j.result as T;
}

export interface DasAgentView {
  id: string;
  isAgent: boolean;
  assetSigner: string | null;
  agentToken: string | null;
  registrationUri: string | null;
  /** SDK findAssetSignerPda(asset) — must equal DAS asset_signer. */
  derivedAssetSigner: string;
  signerAgrees: boolean | null;
  warning: string;
}

/** Shape one DAS row and cross-check asset_signer against the SDK derivation. */
export function dasAgentView(umi: Umi, a: DasAgentAsset): DasAgentView {
  const derived = assetSignerPda(umi, a.id);
  const uri = a.external_plugins?.find((p) => p.type === "AgentIdentity")?.adapter_config?.uri ?? null;
  return {
    id: a.id,
    isAgent: a.is_agent === true,
    assetSigner: a.asset_signer ?? null,
    agentToken: a.agent_token ?? null,
    registrationUri: uri,
    derivedAssetSigner: derived,
    signerAgrees: a.asset_signer ? a.asset_signer === derived : null,
    warning: FUND_ASSET_SIGNER_WARNING,
  };
}

export async function dasGetAgent(umi: Umi, rpc: string, asset: Key, fetchImpl?: FetchLike): Promise<DasAgentView> {
  const a = await das<DasAgentAsset>(rpc, "getAsset", { id: String(asset) }, fetchImpl);
  return dasAgentView(umi, a);
}

export interface DasAgentSearch {
  isAgent?: boolean;
  agentToken?: string;
  assetSigner?: string;
  limit?: number;
  page?: number;
}

/** searchAssets with camelCase filters; interface pinned to MplCoreAsset to exclude collections/groups. */
export function dasSearchParams(q: DasAgentSearch): Record<string, unknown> {
  const p: Record<string, unknown> = { interface: "MplCoreAsset", limit: q.limit ?? 100 };
  if (q.page) p.page = q.page;
  if (q.agentToken) p.agentToken = q.agentToken;
  if (q.assetSigner) p.assetSigner = q.assetSigner;
  if (q.isAgent !== undefined || (!q.agentToken && !q.assetSigner)) p.isAgent = q.isAgent ?? true;
  return p;
}

export async function dasSearchAgents(umi: Umi, rpc: string, q: DasAgentSearch = {}, fetchImpl?: FetchLike): Promise<DasAgentView[]> {
  const r = await das<{ items?: DasAgentAsset[] }>(rpc, "searchAssets", dasSearchParams(q), fetchImpl);
  return (r?.items ?? []).map((a) => dasAgentView(umi, a));
}

// ───────────────────────────── RUN (unsigned) ─────────────────────────────

export interface UnsignedTx {
  action: string;
  /** Wallet that must sign (fee payer + authority). */
  signer: string;
  base64: string;
  signed: false;
  accounts: Record<string, string>;
  warnings: string[];
}

export interface BuildOpts {
  rpc: string;
  /** Inject for offline builds/tests; otherwise fetched from rpc. */
  blockhash?: string;
}

/** A fresh umi whose identity + payer is a NOOP signer for `wallet` — it cannot sign. */
function noopUmi(rpc: string, wallet: Key): Umi {
  return createAgentUmi(rpc).use(signerIdentity(createNoopSigner(pk(wallet))));
}

async function finish(umi: Umi, tb: TransactionBuilder, o: BuildOpts, meta: Omit<UnsignedTx, "base64" | "signed">): Promise<UnsignedTx> {
  const blockhash = o.blockhash ?? (await umi.rpc.getLatestBlockhash()).blockhash;
  const tx = tb.setBlockhash(blockhash).build(umi);
  return { ...meta, base64: Buffer.from(umi.transactions.serialize(tx)).toString("base64"), signed: false };
}

/** RegisterExecutiveV1 — one executive profile per wallet (PDA ["executive_profile", authority]). */
export async function buildRegisterExecutive(o: BuildOpts & { authority: Key }): Promise<UnsignedTx> {
  const umi = noopUmi(o.rpc, o.authority);
  const tb = registerExecutiveV1(umi, { payer: umi.payer, authority: umi.identity });
  return finish(umi, tb, o, {
    action: "registerExecutiveV1", signer: String(o.authority),
    accounts: { executiveProfile: executiveProfilePda(umi, o.authority) },
    warnings: ["Each wallet can have only one executive profile; registering twice fails."],
  });
}

/** DelegateExecutionV1 — must be signed by the agent asset OWNER. */
export async function buildDelegateExecution(o: BuildOpts & { owner: Key; asset: Key; executiveAuthority: Key }): Promise<UnsignedTx> {
  const umi = noopUmi(o.rpc, o.owner);
  const agentIdentity = findAgentIdentityV1Pda(umi, { asset: pk(o.asset) });
  const executiveProfile = findExecutiveProfileV1Pda(umi, { authority: pk(o.executiveAuthority) });
  const tb = delegateExecutionV1(umi, { agentAsset: pk(o.asset), agentIdentity, executiveProfile, payer: umi.payer, authority: umi.identity });
  return finish(umi, tb, o, {
    action: "delegateExecutionV1", signer: String(o.owner),
    accounts: {
      agentAsset: String(o.asset), agentIdentity: String(agentIdentity[0]), executiveProfile: String(executiveProfile[0]),
      executionDelegateRecord: executionDelegateRecordPda(umi, o.executiveAuthority, o.asset),
    },
    warnings: [OPERATIONAL_AUTHORITY_WARNING, "Only the asset owner can delegate; the program rejects any other signer."],
  });
}

/** Verify delegation: derive the record PDA and check that the account exists. */
export async function verifyDelegation(umi: Umi, o: { asset: Key; executiveAuthority: Key }) {
  const record = executionDelegateRecordPda(umi, o.executiveAuthority, o.asset);
  const account = await umi.rpc.getAccount(pk(record));
  return { delegated: account.exists, executionDelegateRecord: record, executiveProfile: executiveProfilePda(umi, o.executiveAuthority) };
}

/** RevokeExecutionV1 — signer is the asset owner OR the executive authority; rent refunds to destination. */
export async function buildRevokeExecution(o: BuildOpts & { signer: Key; asset: Key; executiveAuthority: Key; destination?: Key }): Promise<UnsignedTx> {
  const umi = noopUmi(o.rpc, o.signer);
  const record = executionDelegateRecordPda(umi, o.executiveAuthority, o.asset);
  const destination = o.destination ?? o.signer;
  const tb = revokeExecutionV1(umi, { executionDelegateRecord: pk(record), agentAsset: pk(o.asset), destination: pk(destination), payer: umi.payer, authority: umi.identity });
  return finish(umi, tb, o, {
    action: "revokeExecutionV1", signer: String(o.signer),
    accounts: { executionDelegateRecord: record, agentAsset: String(o.asset), destination: String(destination) },
    warnings: [REVOCATION_SCOPE_NOTE, "Signer must be the asset owner or the executive authority recorded on the delegation."],
  });
}

/**
 * Owner cleanup of an SPL approval left by a previous execution: Core
 * execute(revokeTokenDelegate) with the Asset Signer as token owner. No
 * active executive required — Core Execute validates the asset owner.
 */
export async function buildCleanupApproval(o: BuildOpts & { owner: Key; asset: Key; mint: Key; collection?: Key; tokenAccount?: Key }): Promise<UnsignedTx> {
  const umi = noopUmi(o.rpc, o.owner);
  const signerPda = findAssetSignerPda(umi, { asset: pk(o.asset) });
  const source = o.tokenAccount ? pk(o.tokenAccount) : findAssociatedTokenPda(umi, { mint: pk(o.mint), owner: signerPda[0] })[0];
  const splRevokeIx = revokeTokenDelegate(umi, { source, owner: createNoopSigner(signerPda[0]) });
  const tb = execute(umi, {
    asset: { publicKey: pk(o.asset) },
    ...(o.collection ? { collection: { publicKey: pk(o.collection) } } : {}),
    instructions: splRevokeIx,
  });
  return finish(umi, tb, o, {
    action: "execute(revokeTokenDelegate)", signer: String(o.owner),
    accounts: { asset: String(o.asset), assetSigner: String(signerPda[0]), tokenAccount: String(source), ...(o.collection ? { collection: String(o.collection) } : {}) },
    warnings: ["Pass --collection when the asset belongs to a collection (Core execute requires it)."],
  });
}

