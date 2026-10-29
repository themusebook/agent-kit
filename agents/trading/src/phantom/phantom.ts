/**
 * Phantom Connect config for @phantom/react-sdk, @phantom/browser-sdk and
 * @phantom/react-native-sdk. The kit never touches window.phantom or
 * wallet-adapter in new code; the user's wallet does all signing.
 */
export type PhantomProvider = "injected" | "google" | "apple" | "deeplink";
export const PHANTOM_PACKAGES = { react: "@phantom/react-sdk", browser: "@phantom/browser-sdk", reactNative: "@phantom/react-native-sdk" } as const;

export interface PhantomConfig {
  providers: PhantomProvider[];
  appId?: string;
  addressTypes: ["solana"];
  authOptions?: { redirectUrl: string };
}

export function phantomConfig(o: { providers?: PhantomProvider[]; appId?: string; redirectUrl?: string } = {}): PhantomConfig {
  const providers = o.providers ?? ["injected"];
  const social = providers.some((p) => p === "google" || p === "apple");
  if (social && !o.appId) throw new Error("google/apple providers need an appId from phantom.com/portal");
  if (social && !o.redirectUrl) throw new Error("google/apple providers need a redirectUrl for OAuth");
  return { providers, ...(o.appId ? { appId: o.appId } : {}), addressTypes: ["solana"], ...(social ? { authOptions: { redirectUrl: o.redirectUrl! } } : {}) };
}

/**
 * Extension wallets: signTransaction, then the app posts to Helius Sender.
 * Embedded (google/apple) wallets cannot signTransaction; they must use
 * signAndSendTransaction, which Phantom submits.
 */
export function signingPath(provider: PhantomProvider): "signTransaction+sender" | "signAndSendTransaction" {
  return provider === "google" || provider === "apple" ? "signAndSendTransaction" : "signTransaction+sender";
}

/** React snippet the app can drop in. Blockhash and fees come from the app's own /api/rpc proxy. */
export function reactSnippet(cfg: PhantomConfig): string {
  return `import { PhantomProvider, useSolana, useModal, AddressType } from "@phantom/react-sdk";

export function App({ children }) {
  return (
    <PhantomProvider config={{ providers: ${JSON.stringify(cfg.providers)},${cfg.appId ? ` appId: ${JSON.stringify(cfg.appId)},` : ""} addressTypes: [AddressType.solana]${cfg.authOptions ? `, authOptions: ${JSON.stringify(cfg.authOptions)}` : ""} }}>
      {children}
    </PhantomProvider>
  );
}

// tx: an unsigned VersionedTransaction from the musebook server (already has priority fee + Sender tip).
export async function signAndSubmit(solana, tx) {
  const signed = await solana.signTransaction(tx);
  const b64 = btoa(String.fromCharCode(...signed.serialize()));
  const r = await fetch("https://sender.helius-rpc.com/fast", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "sendTransaction", params: [b64, { encoding: "base64", skipPreflight: true, maxRetries: 0 }] }),
  });
  return (await r.json()).result;
}
`;
}
