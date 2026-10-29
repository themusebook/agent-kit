import { Connection } from "@solana/web3.js";
import {
  deriveAssetSignerPda,
  registerIdentity,
  resolveAgent,
  resolveFromDirectoryRecord,
  verifyAgent,
  fetchRegistrationDocument,
  buildRegistrationDocument,
  validateRegistrationDocument,
  type RegisterIdentityInput,
} from "@themusebook/agent-kit-identity";
import {
  siwsSignIn,
  registerDirectory,
  discoverAgentAuth,
  registerAgentAuth,
  pollGrantStatus,
  readDelegation,
  type DirectoryProfile,
  type AgentRegistrationInput,
} from "@themusebook/agent-kit-auth";
import {
  searchDirectory,
  getDirectoryAgent,
  fetchDirectorySnapshot,
  inspectProvider,
  getMessagingDescriptor,
  negotiateContentProfile,
  fetchSkillsCatalog,
  searchSkills,
  skillsTarballUrl,
  type MessagingDescriptor,
} from "@themusebook/agent-kit-discovery";
import {
  parsePaymentChallenge,
  payChallenge,
  verifyReceipt,
  MailboxClient,
  type PaymentChallenge,
  type PaymentReceipt,
  type PaymentsConfig,
  type SignPayment,
} from "@themusebook/agent-kit-payments";
import {
  meetsTrust,
  requiredTrust,
  type MessageSigner,
  type TransactionSigner,
  type TrustLevel,
} from "@themusebook/agent-kit-wallet";
import {
  buildCreateAndRegisterLaunch,
  buildSetAgentTokenV1,
  type CreateAndRegisterLaunchInput,
  type CreateAndRegisterLaunchPayload,
  type SetAgentTokenV1Descriptor,
  type SetAgentTokenV1Input,
} from "@themusebook/agent-kit-finance";
import {
  AGENT_TEMPLATES,
  buildTemplateRegistration,
  getAgentTemplate,
  type AgentTemplateId,
  type AgentTemplatePreset,
} from "@themusebook/agent-kit-templates";
import {
  createContext,
  type AgentKitOptions,
  type KitContext,
} from "./context";
import {
  AgentKitError,
  TrustLevelError,
  UnsupportedProfileError,
} from "./errors";

export * from "./context";
export * from "./errors";
export {
  buildRegistrationDocument,
  validateRegistrationDocument,
  deriveAssetSignerPda,
};

export interface AgentKit {
  readonly context: KitContext;
  readonly trustLevel: TrustLevel;
  identity: {
    register(input: Omit<RegisterIdentityInput, "signer">): Promise<import("@themusebook/agent-kit-identity").RegisterIdentityResult>;
    resolve(asset: string): Promise<import("@themusebook/agent-kit-identity").ResolvedAgent>;
    /** Resolve from a directory record (snapshot/agents-repo shape) — no RPC. */
    resolveRecord(record: import("@themusebook/agent-kit-identity").DirectoryRecordLike): import("@themusebook/agent-kit-identity").ResolvedAgent;
    verify(asset: string): Promise<{ ok: boolean; problems: string[] }>;
    assetSigner(asset: string): ReturnType<typeof deriveAssetSignerPda>;
    registrationDocument(uri: string): Promise<unknown>;
  };
  auth: {
    signIn(): Promise<import("@themusebook/agent-kit-auth").SiwsSession>;
    registerDirectory(profile: DirectoryProfile): Promise<import("@themusebook/agent-kit-auth").DirectoryRegistration>;
    discover(providerUrl?: string): Promise<import("@themusebook/agent-kit-auth").AgentConfiguration>;
    registerAgent(input: AgentRegistrationInput, sessionToken?: string | null): Promise<import("@themusebook/agent-kit-auth").AgentRegistrationResult>;
    pollGrant(configuration: import("@themusebook/agent-kit-auth").AgentConfiguration, grantId: string): Promise<string>;
    delegation(asset: string): Promise<import("@themusebook/agent-kit-auth").DelegationInfo>;
  };
  discovery: {
    search(query: string, limit?: number): Promise<import("@themusebook/agent-kit-discovery").DirectoryAgent[]>;
    agent(idOrWallet: string): Promise<import("@themusebook/agent-kit-discovery").DirectoryAgent | null>;
    snapshot(): Promise<import("@themusebook/agent-kit-discovery").DirectorySnapshot>;
    skills(query?: string, limit?: number): Promise<import("@themusebook/agent-kit-discovery").SkillCatalogEntry[]>;
    skillsCatalog(): Promise<import("@themusebook/agent-kit-discovery").SkillCatalogEntry[]>;
    skillsTarballUrl(): string;
    provider(url?: string): Promise<import("@themusebook/agent-kit-discovery").ProviderSummary>;
    messagingDescriptor(baseUrl?: string): Promise<MessagingDescriptor>;
    messagingProfiles(agent: { registrationUri: string | null } | MessagingDescriptor): Promise<string[]>;
  };
  payments: {
    pay(resourceUrl: string, signPayment: SignPayment): Promise<PaymentReceipt>;
    payChallenge(challenge: PaymentChallenge, signPayment: SignPayment): Promise<PaymentReceipt>;
    verifyReceipt(receipt: PaymentReceipt): Promise<boolean>;
    mailbox(getAgentToken: () => Promise<string>, endpoint?: string): Promise<MailboxClient>;
  };
  finance: {
    /** Build a Genesis createAndRegisterLaunch payload (pure; submission is the caller's adapter). */
    buildLaunch(input: CreateAndRegisterLaunchInput): CreateAndRegisterLaunchPayload;
    /** Build the PERMANENT setAgentTokenV1 descriptor — refuses without acknowledgePermanent: true. */
    buildSetAgentToken(input: SetAgentTokenV1Input): SetAgentTokenV1Descriptor;
  };
  templates: {
    list(): readonly AgentTemplatePreset[];
    get(id: AgentTemplateId): AgentTemplatePreset;
    registration: typeof buildTemplateRegistration;
  };
  connection(): Connection;
}

function needSigner(signer: MessageSigner | undefined): MessageSigner {
  if (!signer) {
    throw new AgentKitError(
      "signer_required",
      "This action needs a signer. Pass one to createAgentKit({ signer }) — the kit never holds keys.",
    );
  }
  return signer;
}

function needTxSigner(signer: MessageSigner | undefined): TransactionSigner {
  const s = needSigner(signer);
  if (typeof (s as TransactionSigner).signTransaction !== "function") {
    throw new AgentKitError("signer_required", "This action needs a transaction signer (signTransaction).");
  }
  return s as TransactionSigner;
}

/**
 * Create the kit facade. Defaults: hub https://musebook.trade,
 * registry https://registry.musebook.trade, network mainnet-beta.
 */
export function createAgentKit(
  options: AgentKitOptions & { trustLevel?: TrustLevel } = {},
): AgentKit {
  const context = createContext(options);
  const trustLevel: TrustLevel = options.trustLevel ?? "delegated";
  const authConfig = { hub: context.hub };
  const discoveryConfig = { hub: context.hub, registry: context.registry };
  const paymentsConfig: PaymentsConfig = { hub: context.hub, rpc: context.rpc };

  const guard = (action: Parameters<typeof requiredTrust>[0]) => {
    const required = requiredTrust(action);
    if (!meetsTrust(trustLevel, required)) {
      throw new TrustLevelError(action, required, trustLevel);
    }
  };

  return {
    context,
    trustLevel,
    connection: () => new Connection(context.rpc, "confirmed"),
    identity: {
      async register(input) {
        guard("register-identity");
        return registerIdentity(
          { rpc: context.rpc, network: context.network },
          { ...input, signer: needTxSigner(context.signer) },
        );
      },
      resolve: (asset) => resolveAgent({ rpc: context.rpc, network: context.network }, asset),
      resolveRecord: (record) => resolveFromDirectoryRecord(record),
      async verify(asset) {
        const r = await verifyAgent({ rpc: context.rpc, network: context.network }, asset);
        return { ok: r.ok, problems: r.problems };
      },
      assetSigner: (asset) => deriveAssetSignerPda(asset),
      registrationDocument: async (uri) => (await fetchRegistrationDocument(uri)).document,
    },
    auth: {
      signIn: () => siwsSignIn(authConfig, needSigner(context.signer)),
      registerDirectory: (profile) =>
        registerDirectory(authConfig, needSigner(context.signer), profile),
      discover: (providerUrl) => discoverAgentAuth(providerUrl ?? context.hub),
      async registerAgent(input, sessionToken) {
        const configuration = await discoverAgentAuth(context.hub);
        return registerAgentAuth(authConfig, configuration, sessionToken ?? null, input);
      },
      async pollGrant(configuration, grantId) {
        return pollGrantStatus(configuration, grantId);
      },
      delegation: (asset) => readDelegation(context.rpc, asset),
    },
    discovery: {
      search: (query, limit) => searchDirectory(discoveryConfig, query, { limit }),
      agent: (idOrWallet) => getDirectoryAgent(discoveryConfig, idOrWallet),
      snapshot: () => fetchDirectorySnapshot(discoveryConfig),
      skills: (query, limit) => searchSkills(discoveryConfig, query ?? "", { limit }),
      skillsCatalog: () => fetchSkillsCatalog(discoveryConfig),
      skillsTarballUrl: () => skillsTarballUrl(discoveryConfig),
      provider: (url) => inspectProvider(url ?? context.hub),
      messagingDescriptor: (baseUrl) => getMessagingDescriptor(baseUrl ?? context.hub),
      async messagingProfiles(agent) {
        if ("contentProfiles" in agent) return agent.contentProfiles;
        // An agent record: profiles are advertised by its messaging service;
        // without a descriptor at hand, resolve via the hub descriptor.
        const descriptor = await getMessagingDescriptor(context.hub);
        return descriptor.contentProfiles;
      },
    },
    payments: {
      async pay(resourceUrl, signPayment) {
        guard("pay");
        const res = await fetch(resourceUrl);
        if (res.status !== 402) {
          throw new AgentKitError("no_challenge", `Expected HTTP 402 from ${resourceUrl}, got ${res.status}`);
        }
        const body: unknown = await res.json().catch(() => null);
        const challenge = parsePaymentChallenge(body, res.headers.get("x-payment"));
        return payChallenge(paymentsConfig, challenge, needSigner(context.signer), signPayment);
      },
      payChallenge: (challenge, signPayment) => {
        guard("pay");
        return payChallenge(paymentsConfig, challenge, needSigner(context.signer), signPayment);
      },
      verifyReceipt: (receipt) => verifyReceipt(paymentsConfig, receipt),
      async mailbox(getAgentToken, endpoint) {
        const ep = endpoint ?? (await getMessagingDescriptor(context.hub)).endpoint;
        return new MailboxClient({ endpoint: ep, getAgentToken });
      },
    },
    finance: {
      buildLaunch: (input) => buildCreateAndRegisterLaunch(input),
      buildSetAgentToken: (input) => {
        // A permanent identity binding sits behind the same trust gate as
        // identity registration; the builder additionally refuses without
        // acknowledgePermanent: true.
        guard("register-identity");
        return buildSetAgentTokenV1(input);
      },
    },
    templates: {
      list: () => AGENT_TEMPLATES,
      get: (id) => getAgentTemplate(id),
      registration: buildTemplateRegistration,
    },
  };
}
