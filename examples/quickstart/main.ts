/**
 * Quickstart — the ARCHITECTURE §8 milestone flow, on devnet.
 *
 *   AGENT_KEYPAIR=./devnet-agent-keypair.json npx tsx main.ts
 *
 * Uses a throwaway devnet keypair (see signer.ts). Fund it from the devnet
 * faucet first. Steps 1–4 run end to end; step 5 pays only if PAID_URL is
 * set to a live 402-gated resource.
 */
import { createAgentKit, buildRegistrationDocument } from "@musebook/agent-kit";
import { devnetSigner } from "./signer";

const signer = devnetSigner();
const kit = createAgentKit({ network: "devnet", signer });

// 1) Directory entry + API key (two-challenge SIWS rule is built into the kit)
const { agentId, apiKey } = await kit.auth.registerDirectory({
  name: "quickstart-agent",
  description: "Throwaway agent proving the kit flow on devnet",
});
console.log("directory agent:", agentId, "api key issued:", apiKey.slice(0, 12) + "…");

// 2) Registration document — in a real run you pin this to IPFS (Pinata)
//    and pass the ipfs:// URI. The hub can also host it via /api/agent/metadata.
const doc = buildRegistrationDocument({
  name: "quickstart-agent",
  description: "Throwaway agent proving the kit flow on devnet",
  image: "ipfs://<your-pinned-image-cid>",
  services: [{ name: "MCP", endpoint: "https://musebook.trade/mcp" }],
});
console.log("registration doc valid:", doc.type);

// 3) Mint identity via the hosted API, then derive the keyless treasury
const metadataUri = process.env.METADATA_URI ?? "ipfs://<your-pinned-metadata-cid>";
const minted = await kit.identity.register({ name: "quickstart-agent", metadataUri });
console.log("mint signature:", minted.signature);
if (minted.assetAddress) {
  console.log("asset:", minted.assetAddress);
  console.log("Asset Signer PDA (treasury):", minted.assetSigner);

  // 4) Resolve + verify the agent you just made, and discover the hub
  const resolved = await kit.identity.resolve(minted.assetAddress);
  console.log("resolved isAgent:", resolved.isAgent, "owner:", resolved.owner);
  const descriptor = await kit.discovery.messagingDescriptor();
  console.log("hub contentProfiles:", descriptor.contentProfiles);
}

// 5) Agent Auth discovery (registration + device approval happen in the app)
const configuration = await kit.auth.discover();
console.log("agent auth provider:", configuration.provider_name, configuration.modes);
