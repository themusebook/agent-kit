import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  createAgentUmi, assetSignerPda, agentIdentityPda, executiveProfilePda, executionDelegateRecordPda,
  checkRegistration, agentIdentityPlugin, hookListens, dasGetAgent, dasSearchAgents, dasSearchParams,
  readAgentWallet, verifyDelegation,
  buildRegisterExecutive, buildDelegateExecution, buildRevokeExecution, buildCleanupApproval,
  OPERATIONAL_AUTHORITY_WARNING, REVOCATION_SCOPE_NOTE, FUND_ASSET_SIGNER_WARNING,
  MPL_AGENT_IDENTITY_PROGRAM_ID, MPL_AGENT_TOOLS_PROGRAM_ID,
} from "../src/metaplex";
import { deriveAssetSignerPda, deriveAgentIdentityPda } from "../src/assetSigner";

const fx = (n: string) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const RPC = "http://127.0.0.1:1"; // never contacted: blockhash injected, rpc stubbed
const DOC_ASSET = "84jw9dw7hMRJXFvzJXrBzVQpmVWaGUtYT7R6QhNU9qt3";
const DOC_SIGNER = "6ttUwc5VVmHeVKTddB6XM5vQgBMfw62DThuoiVEufVZq";
const OWNER = "CSARgiouTDMmj2zKKg7H83yRQUKMh9J5Ln2LxRUUqRSU";
const EXEC = "AgZH58XPLZnxpS1cxZL22vRoDio53Y6m6gLQtpTnb3QK";
const BLOCKHASH = "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N";
const MINT = "So11111111111111111111111111111111111111112";
const umi = createAgentUmi(RPC);

const jsonFetch = (body: unknown, status = 200) =>
  vi.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

afterEach(() => vi.unstubAllGlobals());

describe("PDA derivations (SDK vs docs seeds)", () => {
  it("Asset Signer = ['mpl-core-execute', asset] under MPL Core; matches the docs' example wallet", () => {
    expect(assetSignerPda(umi, DOC_ASSET)).toBe(DOC_SIGNER);
    expect(assetSignerPda(umi, DOC_ASSET)).toBe(deriveAssetSignerPda(DOC_ASSET).toBase58());
    expect(assetSignerPda(umi, "1RUC5FMQherGNoLF9wDBxa1oznbq1mTieWLZ8gU8S31")).toBe("DwgDrVVwcuXGU2MjHcZEcNtG2cGF6cLXCS35gPiUsU6p");
  });
  it("agent identity PDA: SDK matches the web3.js mirror", () => {
    expect(MPL_AGENT_IDENTITY_PROGRAM_ID).toBe("1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p");
    expect(agentIdentityPda(umi, DOC_ASSET)).toBe(deriveAgentIdentityPda(DOC_ASSET).toBase58());
  });
  it("executive profile = ['executive_profile', authority] under the Agent TOOLS program", () => {
    const [want] = PublicKey.findProgramAddressSync(
      [Buffer.from("executive_profile"), new PublicKey(EXEC).toBuffer()], new PublicKey(MPL_AGENT_TOOLS_PROGRAM_ID));
    expect(MPL_AGENT_TOOLS_PROGRAM_ID).toBe("TLREGni9ZEyGC3vnPZtqUh95xQ8oPqJSvNjvB7FGK8S");
    expect(executiveProfilePda(umi, EXEC)).toBe(want.toBase58());
  });
  it("delegate record = ['execution_delegate_record', profile, asset] under Agent Tools", () => {
    const profile = new PublicKey(executiveProfilePda(umi, EXEC));
    const [want] = PublicKey.findProgramAddressSync(
      [Buffer.from("execution_delegate_record"), profile.toBuffer(), new PublicKey(DOC_ASSET).toBuffer()], new PublicKey(MPL_AGENT_TOOLS_PROGRAM_ID));
    expect(executionDelegateRecordPda(umi, EXEC, DOC_ASSET)).toBe(want.toBase58());
  });
});

describe("READ", () => {
  it("safeFetchAgentIdentityV1 → null (registered=false) for an unregistered asset", async () => {
    const u = createAgentUmi(RPC);
    u.rpc.getAccount = vi.fn(async (k: any) => ({ exists: false, publicKey: k })) as never;
    const r = await checkRegistration(u, DOC_ASSET);
    expect(r).toMatchObject({ registered: false, identity: null, identityPda: agentIdentityPda(u, DOC_ASSET) });
  });
  it("AgentIdentity plugin: uri + transfer/update/execute (docs {__kind:'Listen'} and SDK CheckResult[])", () => {
    const docs = agentIdentityPlugin({ agentIdentities: [{ uri: "https://example.com/agent-registration.json", lifecycleChecks: { transfer: { __kind: "Listen" }, update: { __kind: "Listen" }, execute: { __kind: "Listen" } } }] });
    expect(docs).toMatchObject({ uri: "https://example.com/agent-registration.json", lifecycleChecks: { transfer: true, update: true, execute: true } });
    const sdk = agentIdentityPlugin({ agentIdentities: [{ uri: "u", lifecycleChecks: { transfer: [0], update: [0] } }] });
    expect(sdk?.lifecycleChecks).toEqual({ transfer: true, update: true, execute: false });
    expect(agentIdentityPlugin({})).toBeNull();
    expect(hookListens([2])).toBe(false);
  });
  it("registration document: parses the docs example; non-OK HTTP throws", async () => {
    vi.stubGlobal("fetch", jsonFetch(fx("registration-document.json")));
    const { fetchRegistrationDocument } = await import("../src/resolve");
    const ok = await fetchRegistrationDocument("https://example.com/agent-registration.json");
    expect(ok.document.name).toBe("Plexpert");
    expect(ok.document.services?.map((s) => s.name)).toEqual(["web", "A2A"]);
    vi.stubGlobal("fetch", jsonFetch({}, 404));
    await expect(fetchRegistrationDocument("https://example.com/x.json")).rejects.toThrow("HTTP 404");
  });
  it("wallet = Asset Signer + balance, with the fund-the-signer warning", async () => {
    const u = createAgentUmi(RPC);
    u.rpc.getBalance = vi.fn(async () => ({ basisPoints: 1000000n, identifier: "SOL", decimals: 9 })) as never;
    const w = await readAgentWallet(u, DOC_ASSET);
    expect(w).toEqual({ asset: DOC_ASSET, assetSigner: DOC_SIGNER, lamports: "1000000", warning: FUND_ASSET_SIGNER_WARNING });
  });
});

describe("DAS (snake_case response, camelCase params)", () => {
  it("getAsset registered/no token: is_agent, asset_signer agrees with SDK, no agent_token", async () => {
    const f = jsonFetch({ jsonrpc: "2.0", id: 1, result: fx("das-get-asset-registered.json") });
    const v = await dasGetAgent(umi, "https://das.example", DOC_ASSET, f);
    expect(v).toMatchObject({ isAgent: true, assetSigner: DOC_SIGNER, derivedAssetSigner: DOC_SIGNER, signerAgrees: true, agentToken: null, registrationUri: "https://example.com/agent-registration.json" });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toMatchObject({ method: "getAsset", params: { id: DOC_ASSET } });
  });
  it("getAsset with token surfaces agent_token; a lying asset_signer is flagged", async () => {
    const v = await dasGetAgent(umi, "x", DOC_ASSET, jsonFetch({ result: fx("das-get-asset-with-token.json") }));
    expect(v.agentToken).toBe("FakeToken11111111111111111111111111111111111");
    const bad = await dasGetAgent(umi, "x", DOC_ASSET, jsonFetch({ result: { ...fx("das-get-asset-with-token.json"), asset_signer: EXEC } }));
    expect(bad.signerAgrees).toBe(false);
  });
  it("searchAssets params are camelCase and pinned to MplCoreAsset", async () => {
    expect(dasSearchParams({})).toEqual({ interface: "MplCoreAsset", isAgent: true, limit: 100 });
    expect(dasSearchParams({ agentToken: MINT, limit: 1 })).toEqual({ interface: "MplCoreAsset", agentToken: MINT, limit: 1 });
    expect(dasSearchParams({ assetSigner: DOC_SIGNER })).toEqual({ interface: "MplCoreAsset", assetSigner: DOC_SIGNER, limit: 100 });
    const f = jsonFetch({ result: fx("das-search-agents.json") });
    const rows = await dasSearchAgents(umi, "x", {}, f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "1RUC5FMQherGNoLF9wDBxa1oznbq1mTieWLZ8gU8S31", signerAgrees: true, agentToken: null });
    const body = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(Object.keys(body.params)).not.toContain("is_agent");
  });
  it("DAS HTTP errors throw", async () => {
    await expect(dasGetAgent(umi, "x", DOC_ASSET, jsonFetch({}, 500))).rejects.toThrow("HTTP 500");
  });
});

const decode = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
function assertUnsigned(b64: string, feePayer: string, program: string) {
  const tx = decode(b64);
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  expect(keys[0]).toBe(feePayer);
  expect(keys).toContain(program);
  expect(tx.signatures.every((s) => s.every((b) => b === 0))).toBe(true);
  expect(tx.message.recentBlockhash).toBe(BLOCKHASH);
  return { tx, keys };
}

describe("RUN (unsigned builders only)", () => {
  it("registerExecutiveV1 → unsigned tx creating the executive profile", async () => {
    const r = await buildRegisterExecutive({ rpc: RPC, blockhash: BLOCKHASH, authority: EXEC });
    const { keys } = assertUnsigned(r.base64, EXEC, MPL_AGENT_TOOLS_PROGRAM_ID);
    expect(keys).toContain(executiveProfilePda(umi, EXEC));
    expect(r.signed).toBe(false);
  });
  it("delegateExecutionV1 → owner-signed, carries the Operational authority warning", async () => {
    const r = await buildDelegateExecution({ rpc: RPC, blockhash: BLOCKHASH, owner: OWNER, asset: DOC_ASSET, executiveAuthority: EXEC });
    const { keys } = assertUnsigned(r.base64, OWNER, MPL_AGENT_TOOLS_PROGRAM_ID);
    expect(keys).toEqual(expect.arrayContaining([DOC_ASSET, agentIdentityPda(umi, DOC_ASSET), executiveProfilePda(umi, EXEC), executionDelegateRecordPda(umi, EXEC, DOC_ASSET)]));
    expect(r.warnings).toContain(OPERATIONAL_AUTHORITY_WARNING);
    expect(OPERATIONAL_AUTHORITY_WARNING).toMatch(/ANY instruction/);
  });
  it("verify delegation = record PDA exists", async () => {
    const u = createAgentUmi(RPC);
    const seen: string[] = [];
    u.rpc.getAccount = vi.fn(async (k: any) => { seen.push(String(k)); return { exists: true, publicKey: k }; }) as never;
    const v = await verifyDelegation(u, { asset: DOC_ASSET, executiveAuthority: EXEC });
    expect(v.delegated).toBe(true);
    expect(seen).toEqual([executionDelegateRecordPda(u, EXEC, DOC_ASSET)]);
  });
  it("revokeExecutionV1 → owner or executive signs; rent to destination; revocation-scope note", async () => {
    const r = await buildRevokeExecution({ rpc: RPC, blockhash: BLOCKHASH, signer: EXEC, asset: DOC_ASSET, executiveAuthority: EXEC, destination: OWNER });
    const { keys } = assertUnsigned(r.base64, EXEC, MPL_AGENT_TOOLS_PROGRAM_ID);
    expect(keys).toEqual(expect.arrayContaining([executionDelegateRecordPda(umi, EXEC, DOC_ASSET), OWNER]));
    expect(r.accounts.destination).toBe(OWNER);
    expect(r.warnings).toContain(REVOCATION_SCOPE_NOTE);
  });
  it("cleanup-approval → Core execute wrapping SPL revoke on the Asset Signer's ATA", async () => {
    const r = await buildCleanupApproval({ rpc: RPC, blockhash: BLOCKHASH, owner: OWNER, asset: DOC_ASSET, mint: MINT });
    const { keys } = assertUnsigned(r.base64, OWNER, "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
    expect(keys).toEqual(expect.arrayContaining([DOC_SIGNER, r.accounts.tokenAccount, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"]));
    // only the owner signs the outer tx; the Asset Signer "signs" via Core execute (PDA)
    expect(decode(r.base64).message.header.numRequiredSignatures).toBe(1);
  });
});
