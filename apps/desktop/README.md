# desktop

Tauri 2 shell for the dashboard in [`../app`](../app), as SolanaBot's desktop used Tauri.

- First run shows a launcher asking for the dashboard URL (https, or http for localhost), e.g. the Helm chart's ingress. It is saved locally; open `index.html?change` to edit.
- **No keys and no secrets.** The app bundles only the launcher. The server bearer and keyed RPC stay in the deployed dashboard's proxy. Remote pages get no Tauri IPC.
- **Signing:** desktop webviews cannot load wallet extensions, so when no wallet is injected the dashboard shows *Open in browser to sign*. The shell routes that `window.open` to the system browser, where Phantom (or another wallet) signs. Non-http(s) pop-ups are dropped.

Dropped from SolanaBot desktop: container-engine install, stack bring-up and supervision, provider OAuth, vault, telemetry, tray, PTY, auto-update and signing configs.

```sh
npm ci && npm test && npm run typecheck
npm run tauri dev                 # needs Rust + platform webview libs
npm run tauri build -- --bundles deb,appimage
cd src-tauri && cargo test
```

On Linux the build needs `libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev` (see CI). Installers are unsigned; code signing and notarization are not set up.
