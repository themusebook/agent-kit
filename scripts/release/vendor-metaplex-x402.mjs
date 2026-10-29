// @metaplex-foundation/x402 (0.1.0–0.1.2) ships dist with extensionless relative imports, so
// plain Node ESM cannot import it. Until upstream fixes that, @musebook/x402-metaplex ships a
// copy of its JS (Apache-2.0, LICENSE kept) under dist/vendor/metaplex-x402 with ".js" added,
// and its own dist/*.js import that copy. Types (.d.ts) still point at the real package.
// Usage (from packages/x402-metaplex, after tsc): node ../../scripts/release/vendor-metaplex-x402.mjs
import { cpSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { execFileSync } from "node:child_process";
// The package exports only ".", so locate its root from node_modules directly.
const pkgDir = resolve("node_modules/@metaplex-foundation/x402");
const dist = resolve("dist"), vend = join(dist, "vendor/metaplex-x402");
rmSync(vend, { recursive: true, force: true });
cpSync(join(pkgDir, "dist"), vend, { recursive: true, filter: (f) => !f.endsWith(".map") && !f.endsWith(".d.ts") });
cpSync(join(pkgDir, "LICENSE"), join(vend, "LICENSE"));
execFileSync("node", [resolve(dirname(new URL(import.meta.url).pathname), "fix-esm.mjs"), vend], { stdio: "inherit" });
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let n = 0;
for (const f of walk(dist).filter((f) => f.endsWith(".js") && !f.startsWith(vend))) {
  const src = readFileSync(f, "utf8");
  let rel = relative(dirname(f), join(vend, "index.js")); if (!rel.startsWith(".")) rel = "./" + rel;
  const out = src.replace(/(["'])@metaplex-foundation\/x402\1/g, `$1${rel}$1`);
  if (out !== src) { writeFileSync(f, out); n++; }
}
console.log(`vendor-metaplex-x402: rewrote ${n} files`);
