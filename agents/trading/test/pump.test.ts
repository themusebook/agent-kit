import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PUMP_PROGRAM, PUMP_AMM_PROGRAM, PUMP_FEES_PROGRAM, planCreate, planFeeSharing, checkMetadata, checkShares, classifyTools, PumpAiMcp, DEFAULT_PUMPAI_MCP_URL } from "../src/pumpfun-founder/index.ts";
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID } from "@pump-fun/pump-sdk";
import { decodeUnsignedTx } from "../src/unsigned.ts";
import { fixture } from "./helpers.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const user = Keypair.generate().publicKey;
const ctx = { network: "devnet" as const, user, recentBlockhash: "11111111111111111111111111111111" };
const idl = (n: string) => JSON.parse(readFileSync(join(import.meta.dir, "..", "fixtures", "pump", n), "utf8"));

describe("program ids from pump-public-docs", () => {
  test("match the official SDK and the IDLs", () => {
    expect(PUMP_PROGRAM_ID.toBase58()).toBe(PUMP_PROGRAM);
    expect(PUMP_AMM_PROGRAM_ID.toBase58()).toBe(PUMP_AMM_PROGRAM);
    expect(PUMP_FEE_PROGRAM_ID.toBase58()).toBe(PUMP_FEES_PROGRAM);
    expect(idl("pump.json").address).toBe(PUMP_PROGRAM);
    expect(idl("pump_amm.json").address).toBe(PUMP_AMM_PROGRAM);
    expect(idl("pump_fees.json").address).toBe(PUMP_FEES_PROGRAM);
  });
  test("every instruction the founder uses is in the IDLs", () => {
    const names = (n: string) => idl(n).instructions.map((i: any) => i.name);
    for (const i of ["create_v2", "buy_v2", "buy_exact_quote_in_v3", "sell_v3", "collect_creator_fee_v2", "distribute_creator_fees_v2"]) expect(names("pump.json")).toContain(i);
    for (const i of ["buy", "sell", "collect_coin_creator_fee", "transfer_creator_fees_to_pump_v2"]) expect(names("pump_amm.json")).toContain(i);
    for (const i of ["create_fee_sharing_config", "update_fee_shares_v2"]) expect(names("pump_fees.json")).toContain(i);
  });
});

describe("create", () => {
  test("create_v2 tx: pump program, user signs, mint co-signed in memory", async () => {
    const { tx, mint } = await planCreate(ctx, { name: "Test", symbol: "TST", uri: "https://example.com/m.json" });
    const v = decodeUnsignedTx(tx.base64);
    const keys = v.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(PUMP_PROGRAM);
    const disc = idl("pump.json").instructions.find((i: any) => i.name === "create_v2").discriminator;
    const ix = v.message.compiledInstructions.find((c) => keys[c.programIdIndex] === PUMP_PROGRAM)!;
    expect([...ix.data.slice(0, 8)]).toEqual(disc);
    expect(tx.partiallySignedBy).toEqual([mint]);
    expect(tx.requiredSigners).toEqual([user.toBase58()]);
    expect(tx.network).toBe("devnet");
  });
  test("metadata limits from COIN_CREATION.md", () => {
    expect(() => checkMetadata({ name: "x".repeat(33), symbol: "A", uri: "https://a" })).toThrow(/name/);
    expect(() => checkMetadata({ name: "A", symbol: "x".repeat(14), uri: "https://a" })).toThrow(/symbol/);
    expect(() => checkMetadata({ name: "A", symbol: "A", uri: "https://" + "x".repeat(200) })).toThrow(/uri/);
    expect(() => checkMetadata({ name: "x".repeat(32), symbol: "x".repeat(13), uri: "ipfs://cid" })).not.toThrow();
  });
  test("dev buy needs on-chain Global", async () => {
    await expect(planCreate(ctx, { name: "T", symbol: "T", uri: "https://a", devBuyLamports: "1000" })).rejects.toThrow(/--rpc/);
  });
});

describe("fee sharing", () => {
  test("shares must total 10000 with no duplicates", () => {
    const a = Keypair.generate().publicKey.toBase58(), b = Keypair.generate().publicKey.toBase58();
    expect(() => checkShares([{ address: a, shareBps: 5000 }, { address: b, shareBps: 5000 }])).not.toThrow();
    expect(() => checkShares([{ address: a, shareBps: 5000 }, { address: b, shareBps: 4000 }])).toThrow(/10000/);
    expect(() => checkShares([{ address: a, shareBps: 5000 }, { address: a, shareBps: 5000 }])).toThrow(/duplicate/);
  });
  test("create_fee_sharing_config + update_fee_shares_v2 go to the Pump Fees program", async () => {
    const mint = Keypair.generate().publicKey;
    const s = [{ address: Keypair.generate().publicKey.toBase58(), shareBps: 7000 }, { address: Keypair.generate().publicKey.toBase58(), shareBps: 3000 }];
    const tx = await planFeeSharing(ctx, { mint, graduated: false, shareholders: s });
    const v = decodeUnsignedTx(tx.base64);
    const keys = v.message.staticAccountKeys.map((k) => k.toBase58());
    const fees = idl("pump_fees.json").instructions;
    const disc = (n: string) => fees.find((i: any) => i.name === n).discriminator;
    const datas = v.message.compiledInstructions.filter((c) => keys[c.programIdIndex] === PUMP_FEES_PROGRAM).map((c) => [...c.data.slice(0, 8)]);
    expect(datas).toEqual([disc("create_fee_sharing_config"), disc("update_fee_shares_v2")]);
    expect(tx.partiallySignedBy).toEqual([]);
  });
});

describe("pumpai MCP", () => {
  const listed = fixture("pumpai/tools-list.json").result.tools;
  test("probe fixture: three tools, all readOnlyHint", () => {
    expect(listed.map((t: any) => t.name)).toEqual(["get_health", "get_recent_launches", "render_launch_feed"]);
  });
  test("read tools exposed; write-like or unannotated tools disabled", () => {
    const p = classifyTools([...listed, { name: "buy_token", annotations: { readOnlyHint: true } }, { name: "get_quote" }]);
    expect(p.exposed.map((t) => t.name)).toEqual(["get_health", "get_recent_launches", "render_launch_feed"]);
    expect(p.disabled.map((d) => d.name)).toEqual(["buy_token", "get_quote"]);
  });
  test("client: default URL, session header reused, disabled tools never called", async () => {
    const seen: any[] = [];
    const f = async (_u: string, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body));
      seen.push({ method: body.method, session: (init.headers as any)["mcp-session-id"] });
      const result = body.method === "initialize" ? fixture("pumpai/initialize.json").result : body.method === "tools/list" ? { tools: [...listed, { name: "send_sol", annotations: {} }] } : { content: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json", "mcp-session-id": "s1" } });
    };
    const m = new PumpAiMcp({ fetch: f as any });
    expect(m.url).toBe(process.env.PUMPAI_MCP_URL ?? DEFAULT_PUMPAI_MCP_URL);
    await m.tools();
    await m.callReadTool("get_health");
    await expect(m.callReadTool("send_sol")).rejects.toThrow(/disabled/);
    expect(seen.map((s) => s.method)).toEqual(["initialize", "tools/list", "tools/call"]);
    expect(seen[1].session).toBe("s1");
  });
  test("401 reports auth required", async () => {
    const m = new PumpAiMcp({ url: "https://example.invalid/mcp", fetch: (async () => new Response("", { status: 401 })) as any });
    await expect(m.initialize()).rejects.toThrow(/requires auth/);
  });
});
void PublicKey;
