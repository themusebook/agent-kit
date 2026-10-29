// Packs every publishable package, installs the tarballs into a temp project with plain npm,
// and imports each one under Node ESM. Catches what `npm pack --dry-run` cannot (e.g. missing
// file extensions). Run after `node scripts/release/publish.mjs` (dry run builds dist/).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PUBLISHABLE } from "./packages.mjs";
const dir = mkdtempSync(join(tmpdir(), "musebook-smoke-"));
const tgz = [];
for (const p of PUBLISHABLE) {
  const pm = p.dir.startsWith("packages/") && !p.bin ? "pnpm" : "npm";
  const out = execFileSync(pm, ["pack", "--pack-destination", dir], { cwd: p.dir, encoding: "utf8" }).trim().split("\n").pop();
  tgz.push(resolve(dir, out.split("/").pop()));
}
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "smoke", private: true, type: "module" }));
execFileSync("npm", ["install", "--no-audit", "--no-fund", "--ignore-scripts", ...tgz], { cwd: dir, stdio: "inherit" });
for (const p of PUBLISHABLE) {
  const { name } = JSON.parse(readFileSync(`${p.dir}/package.json`, "utf8"));
  if (p.bin) { execFileSync(join(dir, "node_modules/.bin/musebook"), ["--help"], { cwd: dir, stdio: "ignore" }); console.log(`ok ${name} (bin)`); continue; }
  if (name === "@musebook/x402-metaplex") { console.log(`skip ${name}: upstream @metaplex-foundation/x402 dist uses extensionless imports and fails under Node ESM (bundlers work)`); continue; }
  const n = execFileSync("node", ["--input-type=module", "-e", `const m = await import(${JSON.stringify(name)}); console.log(Object.keys(m).length)`], { cwd: dir, encoding: "utf8" }).trim();
  console.log(`ok ${name}: ${n} exports`);
}
