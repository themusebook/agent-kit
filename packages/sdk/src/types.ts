export type Network = "mainnet" | "devnet";
export type MetaplexNetwork = "solana-mainnet" | "solana-devnet";
export type JsonObject = Record<string, unknown>;

export interface SoftwareAgentRegistration {
  wallet: string;
  nonce: string;
  /** Base64 signature over the exact SIWS challenge message. */
  signature: string;
  slug: string;
  name: string;
  description?: string;
}

export type AgentActionRequest =
  | { action: "launch"; network: Network; name: string; symbol: string; uri: string; supply: string; decimals: number }
  | { action: "trade"; inputMint: string; outputMint: string; amount: string; slippageBps: number }
  | { action: "town"; name: string };
export interface AgentActionHandoff {
  ok: true;
  action: AgentActionRequest["action"];
  reviewUrl: string;
  wallet: string;
  execution: "not_executed";
  approvalRequired: true;
}

export interface SiteLaunchReport {
  network: Network;
  kind: "token" | "agent";
  asset: string;
  creatorWallet: string;
  signatures: string[];
  name: string;
  symbol?: string;
  venue: string;
}
export interface SiteLaunch extends Omit<SiteLaunchReport, "signatures"> {
  _id: string;
  _creationTime?: number;
  signature: string;
  createdAt: number;
}
export interface SiteLaunchesResponse { ok: true; items: SiteLaunch[] }
export interface SiteLaunchQuery { network: Network; kind?: SiteLaunch["kind"] }

export interface GenesisLaunch {
  genesisAddress: string;
  status: string;
  launchPage?: string;
  mechanic?: string;
  type?: string;
  spotlight?: boolean;
  startTime?: string;
  endTime?: string | null;
  heroUrl?: string | null;
  graduatedAt?: string | null;
  lastActivityAt?: string;
}
export interface BaseToken { address: string; name: string; symbol: string; image?: string; description?: string }
export interface LaunchData {
  launch: GenesisLaunch;
  baseToken: BaseToken;
  website?: string;
  socials?: { x?: string; telegram?: string; discord?: string };
}
export interface TokenLaunchData extends Omit<LaunchData, "launch"> { launches: GenesisLaunch[] }
export interface MetaplexLaunchQuery {
  network: MetaplexNetwork;
  status?: "upcoming" | "live" | "graduated";
  spotlight?: boolean;
}
export interface MetaplexAgentQuery {
  network: MetaplexNetwork;
  page?: number;
  pageSize?: number;
  query?: string;
  sort?: "latest" | "oldest";
  activeOnly?: boolean;
  hasAgentToken?: boolean;
  hasServices?: boolean;
  spotlight?: boolean;
}
export interface AgentCard extends JsonObject {
  name: string;
  skills: Array<{ id?: string; name?: string; description?: string; tags?: string[]; [key: string]: unknown }>;
  description?: string;
  url?: string;
  version?: string;
  capabilities?: JsonObject;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
}
export interface MetaplexAgentRecord extends JsonObject {
  mintAddress: string;
  network: MetaplexNetwork;
  name: string;
  walletAddress: string;
  isActive: boolean;
  agentToken?: string | null;
  a2aCard?: AgentCard | null;
}
export interface MetaplexAgentList {
  success: true;
  data: { agents: MetaplexAgentRecord[]; total: number; page: number; pageSize: number; totalPages: number };
}
export interface MetaplexAgentDetail extends JsonObject {
  success: true;
  address: string;
  name: string;
  owner: string;
  walletAddress: string;
  agentToken?: string | null;
  a2aCard?: AgentCard | null;
  tokens?: BaseToken[];
}
export type AgentCardResponse =
  | { status: 200; card: AgentCard; etag: string | null; cacheControl: string | null }
  | { status: 304; card: null; etag: string | null; cacheControl: string | null };

export interface Blockhash { blockhash: string; lastValidBlockHeight: number }
/** Prepared bytes are not a signature, broadcast or confirmation. */
export interface PreparedAgentTransaction { success: true; tx: string; blockhash: Blockhash }
export interface PrepareAgentMintRequest {
  wallet: string;
  network: MetaplexNetwork;
  name: string;
  uri: string;
  agentMetadata: JsonObject;
  collectionAddress?: string;
  a2aCard?: AgentCard;
}
export interface PrepareAgentFundingRequest {
  sender: string;
  /** SOL number, at most nine decimals; must round-trip to exact safe-integer lamports. */
  amount: number;
  memo: string;
  network?: MetaplexNetwork;
}
export type PrepareAgentWithdrawalRequest = Omit<PrepareAgentFundingRequest, "memo">;

export type DasRequest = { jsonrpc?: "2.0"; id?: string | number } & (
  | { method: "getAsset"; params: { id: string } }
  | { method: "getAssets"; params: { ids: string[] } }
  | { method: "getAssetsByOwner"; params: { ownerAddress: string; page?: number; limit?: number } }
  | { method: "searchAssets"; params: { ownerAddress: string; interface: "MplCoreAsset"; page?: number; limit?: number } }
);
export type DasResponse<T = JsonObject> = { jsonrpc: "2.0"; id: string | number | null } & (
  | { result: T; error?: never }
  | { result?: never; error: { code: number; message: string; data?: unknown } }
);
export interface CreatorRewardsRequest { wallet: string; network?: Network | MetaplexNetwork; payer?: string }
export interface CreatorRewardsStatus { ok: boolean; claimable: boolean; txCount: number }
export type PreparedCreatorRewards =
  | { ok: true; claimable: false; transactions: [] }
  | { ok: true; claimable: true; transactions: string[]; blockhash: Blockhash };

export interface MetadataCreator { address: string; share: number; verified: boolean }
export interface MetadataChanges {
  name?: string;
  symbol?: string;
  uri?: string;
  sellerFeeBasisPoints?: number;
  creators?: MetadataCreator[] | null;
  primarySaleHappened?: true;
  isMutable?: false;
  newUpdateAuthority?: string;
  collection?: string | null;
  ruleSet?: string | null;
}
export type MetadataActionInput = { wallet: string; network: Network } & (
  | { action: "update"; changes: MetadataChanges }
  | { action: "verify-creator" | "unverify-creator" }
  | { action: "lock" | "unlock"; token: string }
  | { action: "burn"; token: string; amount: string }
);
export interface MetadataState {
  mint: string; metadata: string; name: string; symbol: string; uri: string;
  sellerFeeBasisPoints: number; creators: MetadataCreator[] | null; updateAuthority: string;
  isMutable: boolean; primarySaleHappened: boolean; standard: number | null; standardName: string;
  decimals: number; supply: string; collection: { key: string; verified: boolean } | null; ruleSet: string | null;
  token: { address: string; owner: string; amount: string; delegate: string | null; delegatedAmount: string;
    state: number; record: string | null; recordState: number | null; recordDelegate: string | null; delegateRole: number | null } | null;
}
export interface PreparedMetadataAction extends Blockhash {
  spec: MetadataActionInput & { mint: string };
  state: MetadataState;
  tx: string;
}

export interface RwaAccessCheck { id: string; title: string; state: "required" | "unavailable"; detail: string }
export interface RwaStatus {
  ok: true; protocol: "MPL-3643"; network: "solana-mainnet"; stage: "alpha-access-required";
  launchEnabled: false; transactionBuilderAvailable: false; rpcConfigured: boolean;
  checks: RwaAccessCheck[]; docs: string; alphaAccessUrl: string; auditStatus: "pre-audit";
}
export interface RwaPairingInput {
  kind: "pairing"; name: string; agentAsset: string; agentTokenMint: string; quoteMint: string;
  quoteKind: "tokenized-stock" | "mpl3643" | "other";
}
export interface RwaIssuanceInput {
  kind: "issuance"; name: string; symbol: string;
  assetClass: "Private fund" | "Equity" | "Real estate" | "Commodity" | "Credit" | "Other";
  metadataUri: string; agentAsset: string; issuerWallet: string; issuerRoleGrant: string; trustedAttestor: string;
  extraClaimTopics: string; decimals: number; supply: string; countries: string; transferHook: boolean;
  holderCap: string; investorCap: string; lockupDays: number; yieldEnabled: boolean; recoveryEnabled: boolean;
  recoveryProposer: string; recoveryApprover: string; recoveryDelayHours: number;
}
export type RwaInput = RwaPairingInput | RwaIssuanceInput;
export interface RwaPlan {
  schema: "musebook.rwa-plan.v1"; status: "draft"; network: "solana-mainnet"; generatedAt: string;
  input: RwaInput; canonicalAgentToken: "unchanged";
  execution: { allowed: false; transactions: []; reason: string };
  checks: RwaAccessCheck[]; steps: Array<{ id: string; title: string; detail: string; irreversible?: boolean }>;
  supplyRaw?: string; claimTopics?: string[]; jurisdictionAllowlist?: string[];
}
export interface ChatgptSignInStatus { enabled: boolean; status: "configured" | "not_configured"; identityOnly: true }
