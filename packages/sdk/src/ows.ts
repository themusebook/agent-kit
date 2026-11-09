/** Optional local Node.js wallet integration. Never import into a browser bundle. */
export const OWS_SOLANA_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

export interface OWSSolanaWallet {
  id: string;
  name: string;
  createdAt: string;
  address: string;
  chainId: typeof OWS_SOLANA_CHAIN;
  derivationPath: string;
}
export interface OWSSignature {
  wallet: OWSSolanaWallet;
  /** Detached Ed25519 signature; not a signed transaction envelope. */
  signature: string;
  encoding: 'hex';
  signatureBase64: string;
}
export interface OWSClient {
  /** Creates a 24-word encrypted OWS wallet; returns only its public Solana account. */
  createWallet(input: { name: string; passphrase: string }): OWSSolanaWallet;
  listWallets(): OWSSolanaWallet[];
  getWallet(nameOrId: string): OWSSolanaWallet;
  /** Owner passphrase or an ows_key_ token. Tokens retain native OWS policy enforcement. */
  signMessage(input: { wallet: string; message: string; credential: string }): OWSSignature;
  /** Full serialized Solana transaction as hex, including signature slots. No broadcast. */
  signTransaction(input: { wallet: string; transactionHex: string; credential: string }): OWSSignature;
}

/**
 * Load the optional official OWS 1.4.3 native SDK. Install it alongside Musebook:
 * npm install @musebook/sdk @open-wallet-standard/core@1.4.3
 * Native binaries support macOS/glibc Linux on ARM64/x64. Vault defaults to ~/.ows.
 * Credentials are passed explicitly per operation and are never retained by this client.
 */
export async function createOWSClient(options: { vaultPath?: string } = {}): Promise<OWSClient> {
  const core = await import('@open-wallet-standard/core').catch(() => {
    throw new Error('OWS requires Node.js on macOS or Linux. Install @open-wallet-standard/core@1.4.3 with optional dependencies enabled.');
  });
  const vault = options.vaultPath;
  if (vault !== undefined && (typeof vault !== 'string' || !vault)) throw new TypeError('vaultPath must be a nonempty local path');
  function descriptor(wallet: { id: string; name: string; createdAt: string; accounts: { chainId: string; address: string; derivationPath: string }[] }): OWSSolanaWallet {
    const account = wallet.accounts.find(a => a.chainId === OWS_SOLANA_CHAIN);
    if (!account) throw new Error('OWS wallet has no Solana account');
    return { id: wallet.id, name: wallet.name, createdAt: wallet.createdAt, address: account.address, chainId: OWS_SOLANA_CHAIN, derivationPath: account.derivationPath };
  }
  function credential(value: string) {
    if (typeof value !== 'string' || !value || value.length > 1024) throw new TypeError('An explicit owner passphrase or OWS API token is required');
    if (value.startsWith('ows_key_') && !/^ows_key_[a-f0-9]{64}$/.test(value)) throw new TypeError('Malformed OWS API token');
  }
  function result(wallet: OWSSolanaWallet, signature: string): OWSSignature {
    if (!/^[a-f0-9]{128}$/i.test(signature)) throw new Error('OWS returned an invalid Solana signature');
    const bytes = signature.match(/../g)!.map(hex => Number.parseInt(hex, 16));
    return { wallet, signature, encoding: 'hex', signatureBase64: btoa(String.fromCharCode(...bytes)) };
  }
  const getWallet = (id: string) => {
    if (typeof id !== 'string' || !id || id.length > 128) throw new TypeError('A wallet name or ID is required');
    return descriptor(core.getWallet(id, vault));
  };
  return {
    createWallet({ name, passphrase }) {
      if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(name)) throw new TypeError('Wallet name must be 1–64 letters, numbers, spaces, underscores or hyphens');
      if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024 || passphrase.startsWith('ows_key_')) throw new TypeError('Use an owner passphrase of 12–1024 characters');
      if (core.listWallets(vault).some(w => w.name === name)) throw new Error('Wallet name already exists; select it by ID');
      return descriptor(core.createWallet(name, passphrase, 24, vault));
    },
    listWallets: () => core.listWallets(vault).filter(w => w.accounts.some(a => a.chainId === OWS_SOLANA_CHAIN)).map(descriptor),
    getWallet,
    signMessage({ wallet: id, message, credential: secret }) {
      credential(secret);
      if (typeof message !== 'string' || !message || new TextEncoder().encode(message).length > 8192) throw new TypeError('Message must contain 1–8192 UTF-8 bytes');
      const wallet = getWallet(id);
      return result(wallet, core.signMessage(wallet.id, OWS_SOLANA_CHAIN, message, secret, 'utf8', 0, vault).signature);
    },
    signTransaction({ wallet: id, transactionHex, credential: secret }) {
      credential(secret);
      if (typeof transactionHex !== 'string' || !/^(?:[a-f0-9]{2})+$/i.test(transactionHex) || transactionHex.length > 2464) throw new TypeError('transactionHex must be a full serialized Solana transaction, at most 1232 bytes, without 0x');
      const wallet = getWallet(id);
      return result(wallet, core.signTransaction(wallet.id, OWS_SOLANA_CHAIN, transactionHex, secret, 0, vault).signature);
    },
  };
}
