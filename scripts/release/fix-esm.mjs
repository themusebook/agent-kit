// Node ESM needs explicit file extensions. The sources use extensionless relative imports
// (moduleResolution "bundler"), so after tsc we add ".js" / "/index.js" in dist/*.js and *.d.ts.
// Usage (from a package dir): node ../../scripts/release/fix-esm.mjs [dist]
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
const root = resolve(process.argv[2] ?? "dist");
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bexport\s*\*\s*from\s*)(["'])(\.{1,2}\/[^"']*)\2/g;
let changed = 0;
for (const file of walk(root).filter((f) => /\.(js|d\.ts)$/.test(f))) {
  const src = readFileSync(file, "utf8");
  const out = src.replace(RE, (m, pre, q, spec) => {
    if (/\.(m?js|json)$/.test(spec)) return m;
    if (spec.endsWith(".ts")) spec = spec.slice(0, -3);
    const base = resolve(dirname(file), spec);
    const fixed = existsSync(base + ".js") ? spec + ".js" : existsSync(join(base, "index.js")) ? spec + "/index.js" : null;
    if (!fixed) throw new Error(`${file}: cannot resolve ${spec}`);
    return `${pre}${q}${fixed}${q}`;
  });
  if (out !== src) { writeFileSync(file, out); changed++; }
}
console.log(`fix-esm: ${changed} files in ${root}`);
