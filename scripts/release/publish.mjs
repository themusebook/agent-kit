// Build, pack and (only with --publish) publish every @musebook package in dependency order.
// Default is a dry run. Publishing needs NODE_AUTH_TOKEN in the environment (the release
// workflow maps it from the NPM_TOKEN GitHub secret); this script never reads or stores a token itself.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { PUBLISHABLE } from "./packages.mjs";

const publish = process.argv.includes("--publish");
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const published = (name, version) => {
  try { return execFileSync("npm", ["view", `${name}@${version}`, "version"], { encoding: "utf8" }).trim() === version; }
  catch { return false; }
};

for (const pkg of PUBLISHABLE) {
  const { name, version } = JSON.parse(readFileSync(`${pkg.dir}/package.json`, "utf8"));
  const usesPnpm = pkg.dir.startsWith("packages/") && !pkg.bin;
  if (!pkg.bin && !pkg.raw) run(pkg.dir === "agents/trading" ? "node_modules/.bin/tsc" : "../../node_modules/.bin/tsc", ["-p", "tsconfig.build.json"], pkg.dir);
  if (!pkg.bin && !pkg.raw) run("node", ["../../scripts/release/fix-esm.mjs"], pkg.dir);
  if (pkg.vendor) run("node", [`../../scripts/release/${pkg.vendor}`], pkg.dir);
  if (!publish) { run("npm", ["pack", "--dry-run"], pkg.dir); continue; }
  if (published(name, version)) { console.log(`skip ${name}@${version}: already on npm`); continue; }
  // pnpm rewrites workspace:* ranges to real versions at publish time; npm does not.
  if (usesPnpm) run("pnpm", ["publish", "--access", "public", "--provenance", "--no-git-checks"], pkg.dir);
  else run("npm", ["publish", "--access", "public", "--provenance"], pkg.dir);
}
