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
  "@musebook/identity": pkg("identity"),
  "@musebook/discovery": pkg("discovery"),
  "@musebook/payments": pkg("payments"),
  "@musebook/wallet": pkg("wallet"),
  "@musebook/auth": pkg("auth"),
};
module.exports = config;
