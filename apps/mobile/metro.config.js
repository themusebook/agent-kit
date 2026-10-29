// The SDK packages live in ../../packages (source, not published). Let Metro
// read them and resolve their deps from this app's node_modules.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const root = path.resolve(__dirname, "../..");
const config = getDefaultConfig(__dirname);
const pkg = (name) => path.join(root, "packages", name, "src/index.ts");

config.watchFolders = [path.join(root, "packages")];
config.resolver.nodeModulesPaths = [path.join(__dirname, "node_modules")];
config.resolver.extraNodeModules = {
  "@themusebook/agent-kit-identity": pkg("identity"),
  "@themusebook/agent-kit-discovery": pkg("discovery"),
  "@themusebook/agent-kit-payments": pkg("payments"),
  "@themusebook/agent-kit-wallet": pkg("wallet"),
  "@themusebook/agent-kit-auth": pkg("auth"),
};
module.exports = config;
