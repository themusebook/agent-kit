# mobile (Android, Solana Mobile)

Expo (SDK 58, React Native 0.88) app for Seeker/Saga and other Android phones, with the dashboard's views: **Directory, Messaging, Jobs, Identity, Mint**.

- **No keys.** Signing goes only through Mobile Wallet Adapter (`@solana-mobile/mobile-wallet-adapter-protocol-web3js` 3.0.1 `transact` → `authorize({ identity, chain })` → `signTransactions` / `signMessages`) in the user's wallet app: Seed Vault, Phantom, Solflare. `src/mwa.ts` adapts that to the SDK's `TransactionSigner`, so `registerIdentity` (mint) asks the wallet.
- **No secrets.** The app points at a deployed dashboard (`apps/app` behind its proxy, e.g. the Helm chart ingress) and uses its `/server` and `/rpc` routes. It stores only that URL. `EXPO_PUBLIC_DASHBOARD_URL` can prefill it; `EXPO_PUBLIC_SOLANA_NETWORK=mainnet-beta` switches off devnet.
- SDK packages are read from `../../packages/*/src` (see `metro.config.js`).

MWA is a native module, so Expo Go won't work. Use a dev build:

```sh
npm ci && npm test && npm run typecheck
npx expo prebuild -p android     # generates android/ (gitignored)
cd android && ./gradlew assembleDebug   # needs JDK 17+ and the Android SDK
```

Dropped from SolanaBot mobile (ChatGPTEE): chat, memory views, SIWS sign-in to OpenBot, Seeker Connect, expo-router, secure-store sessions, quick-crypto, `@solana/kit` (the SDK uses web3.js v1).

## Solana dApp Store publishing (notes only; nothing submitted)

1. Build a **release** APK signed with your own upload keystore kept outside the repo (`./gradlew assembleRelease` with signing config from env, or `eas build -p android --profile dapp-store`).
2. `npx @solana-mobile/dapp-store-cli init`, then fill the placeholders in `dapp-store/config.yaml` (publisher, URLs, 1080x1920 screenshots, APK path).
3. `npx @solana-mobile/dapp-store-cli create publisher|app|release -k <publisher keypair outside the repo>`. Each mints an NFT and costs a little SOL.
4. `publish submit` only after a human reviews the release. Bump `ANDROID_VERSION_CODE` for every release.
