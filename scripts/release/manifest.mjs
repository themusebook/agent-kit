// Normalises every publishable package.json under the @musebook scope. Idempotent.
// Usage: node scripts/release/manifest.mjs   (rewrites in place; commit the result)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { PUBLISHABLE } from "./packages.mjs";

const REPO = "https://github.com/themusebook/agent-kit";
for (const pkg of PUBLISHABLE) {
  const file = `${pkg.dir}/package.json`;
  const p = JSON.parse(readFileSync(file, "utf8"));
  delete p.private;
  p.name = pkg.name;
  p.version = p.version && p.name === pkg.name && p.version !== "0.3.0" ? p.version : "0.1.0";
  p.license = "MIT";
  p.repository = { type: "git", url: `git+${REPO}.git`, directory: pkg.dir };
  p.homepage = `${REPO}/tree/main/${pkg.dir}#readme`;
  p.bugs = { url: `${REPO}/issues` };
  p.files = pkg.files ?? ["dist", "README.md", "LICENSE"];
  if (!pkg.bin) {
    p.main = "./dist/index.js";
    p.types = "./dist/index.d.ts";
    p.exports = { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } };
    for (const s of pkg.subpaths ?? []) p.exports[`./${s}`] = { types: `./dist/${s}/index.d.ts`, default: `./dist/${s}/index.js` };
    p.exports["./package.json"] = "./package.json";
  }
  p.sideEffects = false;
  p.publishConfig = { access: "public", provenance: true };
  if (!existsSync(`${pkg.dir}/tsconfig.build.json`) && !pkg.bin) {
    writeFileSync(`${pkg.dir}/tsconfig.build.json`, JSON.stringify({ extends: pkg.buildBase ?? "../../tsconfig.build.json", compilerOptions: { rootDir: "src", outDir: "dist" }, include: ["src"] }, null, 2) + "\n");
  }
  if (!pkg.bin) { p.scripts = { ...p.scripts, build: "tsc -p tsconfig.build.json", prepack: "node ../../scripts/release/check-dist.mjs" }; }
  writeFileSync(file, JSON.stringify(p, null, 2) + "\n");
  console.log(`${p.name}@${p.version}`);
}
