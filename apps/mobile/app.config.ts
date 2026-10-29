import type { ExpoConfig } from "expo/config";

const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? "1");

/** musebook agents for Solana Mobile (Seeker, Saga, the Solana dApp Store). Android only. */
const config: ExpoConfig = {
  name: "musebook agents",
  slug: "musebook-agents",
  version: "0.1.0",
  scheme: "musebookagents",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  platforms: ["android"],
  android: {
    package: "trade.musebook.agents",
    versionCode,
    adaptiveIcon: { foregroundImage: "./assets/android-icon-foreground.png", backgroundColor: "#07060b" },
    permissions: ["INTERNET"],
    blockedPermissions: ["android.permission.RECORD_AUDIO", "android.permission.CAMERA", "android.permission.SYSTEM_ALERT_WINDOW"],
  },
};
export default config;
