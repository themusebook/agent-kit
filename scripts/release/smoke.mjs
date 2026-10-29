// Packs every publishable package, installs the tarballs into a temp project with plain npm,
// and imports each one under Node ESM. Catches what `npm pack --dry-run` cannot (e.g. missing
// file extensions). Run after `node scripts/release/publish.mjs` (dry run builds dist/).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
// A published file must never import outside its own package (e.g. "../../a2a-network/src"):
// it works here only because every tarball is installed side by side.
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? (f === "node_modules" ? [] : walk(join(d, f))) : [join(d, f)]));
for (const p of PUBLISHABLE) {
  const root = join(dir, "node_modules", p.name);
  for (const f of walk(root).filter((f) => /\.(m?js)$/.test(f))) {
    for (const [, spec] of readFileSync(f, "utf8").matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']*)["']/g)) {
      if (!resolve(dirname(f), spec).startsWith(root + "/")) throw new Error(`${f}: import ${spec} escapes ${p.name}`);
    }
  }
}
for (const p of PUBLISHABLE) {
  const { name } = JSON.parse(readFileSync(`${p.dir}/package.json`, "utf8"));
  if (p.bin) { const help = execFileSync(join(dir, "node_modules/.bin/musebook"), ["--help"], { cwd: dir, encoding: "utf8" }); if (/not published|runs from this repo/i.test(help)) throw new Error("musebook --help still says unpublished"); console.log(`ok ${name} (bin)`); continue; }
  for (const spec of [name, ...(p.subpaths ?? []).map((s) => `${name}/${s}`)]) {
    const n = execFileSync("node", ["--input-type=module", "-e", `const m = await import(${JSON.stringify(spec)}); console.log(Object.keys(m).length)`], { cwd: dir, encoding: "utf8" }).trim();
    console.log(`ok ${spec}: ${n} exports`);
  }
}
