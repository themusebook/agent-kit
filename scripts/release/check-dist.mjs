// prepack guard: refuse to pack without a build, and refuse anything that looks like key material.
import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
if (!existsSync("dist/index.js")) { console.error("dist/ missing: run the build first"); process.exit(1); }
const bad = [/BEGIN [A-Z ]*PRIVATE KEY/, /"secretKey"\s*:/, /\[\s*(\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk("dist")) {
  const s = readFileSync(f, "utf8");
  for (const re of bad) if (re.test(s)) { console.error(`refusing to pack: ${f} matches ${re}`); process.exit(1); }
}
