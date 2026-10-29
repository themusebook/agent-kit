/**
 * Agent-kit tools over Metaplex x402: chat, images, paid RPC/DAS, discovery,
 * and delegate status/approve/revoke. Each tool is { name, description, run }.
 */
import { METAPLEX_X402_BASE_URL, METAPLEX_X402_RPC_URL, getModels, getPricing } from "@metaplex-foundation/x402";
import type { KeyPairSigner } from "@solana/kit";
import { SpendGuard } from "./guard.js";
import { delegateApprove, delegateRevoke, delegateStatus } from "./payers.js";

export interface X402Tool<A = any, R = any> {
  name: string;
  description: string;
  paid: boolean;
  run(args: A): Promise<R>;
}

export interface X402ToolsOptions {
  /** A guarded paying fetch from one of the payers (or plain fetch for discovery). */
  fetch: typeof fetch;
  guard: SpendGuard;
  baseUrl?: string;
  rpcUrl?: string;
  /** Needed only for delegate approve/revoke. */
  owner?: { signer: KeyPairSigner; asset: string; solanaRpcUrl: string };
}

async function json(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`x402 ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

export function createX402Tools(o: X402ToolsOptions): X402Tool[] {
  const base = (o.baseUrl ?? METAPLEX_X402_BASE_URL).replace(/\/+$/, "");
  const rpc = o.rpcUrl ?? METAPLEX_X402_RPC_URL;
  const post = (url: string, body: unknown) =>
    o.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(json);
  let id = 0;
  const rpcCall = (method: string, params: unknown) => post(rpc, { jsonrpc: "2.0", id: ++id, method, params });

  const tools: X402Tool[] = [
    { name: "x402_models", paid: false, description: "List Metaplex x402 models (free).", run: () => getModels() },
    { name: "x402_pricing", paid: false, description: "Metaplex x402 pricing: chat/image per-token rates, minimums, RPC per-method (free).", run: () => getPricing() },
    {
      name: "x402_chat", paid: true, description: "OpenAI-compatible chat completion paid via x402 (guarded).",
      run: (a: { model: string; messages: { role: string; content: string }[]; max_tokens?: number }) => post(`${base}/chat/completions`, a),
    },
    {
      name: "x402_image", paid: true, description: "Image generation paid via x402 (guarded).",
      run: (a: { model: string; prompt: string; size?: string }) => post(`${base}/images/generations`, a),
    },
    {
      name: "x402_rpc", paid: true, description: "Paid Solana JSON-RPC over HTTP (no websockets).",
      run: (a: { method: string; params?: unknown[] }) => rpcCall(a.method, a.params ?? []),
    },
    {
      name: "x402_das_get_asset", paid: true, description: "DAS getAsset via paid RPC.",
      run: (a: { id: string }) => rpcCall("getAsset", { id: a.id }),
    },
    {
      name: "x402_das_assets_by_owner", paid: true, description: "DAS getAssetsByOwner via paid RPC.",
      run: (a: { owner: string; limit?: number }) => rpcCall("getAssetsByOwner", { ownerAddress: a.owner, limit: a.limit ?? 50 }),
    },
    { name: "x402_delegate_status", paid: false, description: "Is the Metaplex execute delegate approved for an asset? (free)", run: (a: { asset: string }) => delegateStatus(a.asset) },
    {
      name: "x402_delegate_approve", paid: true, description: "Approve the execute delegate once (on-chain; needs pay mode + confirm).",
      run: async (a: { confirm: boolean }) => {
        if (!o.owner) throw new Error("owner not configured");
        return delegateApprove(o.owner.signer, { asset: o.owner.asset, rpcUrl: o.owner.solanaRpcUrl, guard: o.guard, confirm: a.confirm === true });
      },
    },
    {
      name: "x402_delegate_revoke", paid: false, description: "Revoke the execute delegate (on-chain; needs confirm).",
      run: async (a: { confirm: boolean }) => {
        if (!o.owner) throw new Error("owner not configured");
        return delegateRevoke(o.owner.signer, { asset: o.owner.asset, rpcUrl: o.owner.solanaRpcUrl, confirm: a.confirm === true });
      },
    },
    { name: "x402_budget", paid: false, description: "Spend-guard state: mode, caps, spent, remaining.", run: async () => ({ mode: o.guard.mode, maxPerRequestUsd: o.guard.maxPerRequestUsd, sessionBudgetUsd: o.guard.sessionBudgetUsd, spentUsd: o.guard.spent, remainingUsd: o.guard.remaining }) },
  ];
  return tools;
}

/**
 * Tighten the guard from live pricing: a per-request cap below the API's own
 * minimum request price would refuse everything, so warn the caller.
 */
export async function checkCapsAgainstPricing(guard: SpendGuard) {
  const p = await getPricing();
  const minimum = Math.min(p.chatCompletions.minimum.amount, p.imageGenerations.minimum.amount, p.rpc.default);
  return { minimumUsd: minimum, capCoversMinimum: guard.maxPerRequestUsd >= minimum };
}
