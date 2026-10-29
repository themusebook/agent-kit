import type { KeyObject } from 'node:crypto';
export declare const ORIGIN: string;
export declare const A2A_VERSION: string;
export declare const X402M_EXTENSION: string;
export declare const MESSAGING_SCOPES: string[];
export interface AgentInterface { url: string; protocolBinding: string; protocolVersion: string; tenant?: string }
export interface AgentCard { name: string; description: string; version: string; supportedInterfaces: AgentInterface[]; capabilities: Record<string, unknown>; defaultInputModes: string[]; defaultOutputModes: string[]; skills: Array<{ id: string; name: string; description: string; tags: string[] }>; [k: string]: unknown }
export interface NetworkAgent { handle: string; name?: string; description?: string; agentId?: string; a2a: boolean; relay: boolean; model?: string; capabilities?: string[]; lastSeen?: string }
export declare function signJwt(header: object, payload: object, privateKey: KeyObject): string;
export declare function agentJwt(o: { agentId: string; privateKey: KeyObject; origin?: string; url: string; body: string; capabilities?: string[]; now?: number; jti?: string }): string;
export declare function validateAgentCard(card: unknown): string[];
export declare function jsonRpcInterface(card: AgentCard): AgentInterface;
type FetchLike = (input: string, init?: any) => Promise<any>;
export declare class MusebookA2A {
  constructor(o?: { origin?: string; fetchImpl?: FetchLike; agentId?: string; privateKey?: KeyObject });
  origin: string;
  rootCard(): Promise<AgentCard>;
  relayManifest(): Promise<any>;
  relayHealth(): Promise<any>;
  listRelayAgents(): Promise<any[]>;
  listAgents(): Promise<Array<{ agent_id: string; handle: string; name: string; description: string }>>;
  listAll(): Promise<NetworkAgent[]>;
  card(handleOrUrl: string): Promise<AgentCard>;
  rpc(method: string, params?: object, o?: { url?: string }): Promise<any>;
  send(handle: string, text: string, o?: { contextId?: string; taskId?: string; returnImmediately?: boolean; messageId?: string }): Promise<any>;
  getTask(id: string, tenant?: string): Promise<any>;
  listTasks(params?: object): Promise<any>;
}
export interface ConnectResult { origin: string; agentId: string; hostId: string; handle: string; wallet: string; card: unknown; cardUrl: string }
export declare function connect(o: { wallet: string; handle: string; name: string; description?: string; signMessage: (message: string) => Promise<string> | string; save: (name: string, data: unknown) => Promise<void> | void; origin?: string; fetchImpl?: FetchLike; keygen?: () => { publicKey: KeyObject; privateKey: KeyObject } }): Promise<ConnectResult>;
export declare function clientFromIdentity(o: { identity: { origin: string; agentId: string }; agentJwk: any; fetchImpl?: FetchLike }): MusebookA2A;
export declare const NETWORK_COLLECTION_ENV: string;
export declare function networkServices(o: { handle: string; origin?: string }): Array<{ name: string; endpoint: string; version?: string }>;
export declare function routeFromRegistration(doc: unknown): { cardUrl: string; handle?: string; version?: string } | null;
export declare function verifyPeer(o: { asset: any; doc: any; collection?: string; claimedHandle?: string }): { ok: boolean; problems: string[]; route: ReturnType<typeof routeFromRegistration> };
export declare function discoverNetwork(o: { rpc: string; collection: string; fetchImpl?: FetchLike; limit?: number; fetchDoc?: (uri: string) => Promise<any> }): Promise<Array<{ asset: string; owner?: string; name?: string; ok: boolean; problems: string[]; route: any }>>;
