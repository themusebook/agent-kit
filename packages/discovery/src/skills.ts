/**
 * Skills catalog discovery.
 *
 * Canonical home: the skills repo — github.com/themusebook/skills
 * (transferred from Solizardking/skills; the old path redirects). The repo
 * publishes a flat catalog at catalog.json:
 *   [ { slug, name, description, category }, ... ]   (599 entries)
 * and one folder per skill under skills/<slug>/SKILL.md whose YAML
 * frontmatter follows the standard skill shape:
 *   ---
 *   name: ask-mcp
 *   description: "..."
 *   metadata:            # optional
 *     source: https://github.com/<upstream>
 *     documentation: https://…
 *     openclaw:
 *       requires: { env: [], bins: [] }
 *   allowed-tools:       # optional
 *     - Read
 *   ---
 *
 * The live site surface is musebook.trade/skills, and the hub serves the
 * live catalog at GET {hub}/api/skills — a flat list of
 *   { slug, name, description, category, path, version }
 * (272 entries, verified 2026-10-29; `path` is the SKILL.md path inside
 * the install tarball, e.g. "1password/SKILL.md"). fetchSkillsCatalog
 * prefers that live endpoint and falls back to the repo's catalog.json.
 * The install tarball itself is at {hub}/clawd-skills.tar.gz
 * (layout: skills/<slug>/SKILL.md + references). Note /live/skills.json
 * and /skills.json are NOT endpoints (404) — /api/skills is the live one.
 */

export interface SkillsConfig {
  hub: string;
  /** Live catalog endpoint override. Default: {hub}/api/skills. */
  apiUrl?: string;
  /** Fallback catalog.json URL. Default: the canonical skills repo on GitHub. */
  catalogUrl?: string;
}

export const DEFAULT_SKILLS_CATALOG_URL =
  "https://raw.githubusercontent.com/themusebook/skills/main/catalog.json";

export const SKILLS_REPO_URL = "https://github.com/themusebook/skills";

export interface SkillCatalogEntry {
  slug: string;
  name: string;
  description: string | null;
  category: string | null;
  /** SKILL.md path inside the install tarball (live API entries only). */
  path: string | null;
  /** Catalog version string, when the source provides one. */
  version: string | null;
  raw: unknown;
}

export function normalizeSkillEntry(raw: Record<string, unknown>): SkillCatalogEntry {
  const s = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    slug: s(raw.slug) ?? s(raw.name) ?? "",
    name: s(raw.name) ?? s(raw.slug) ?? "",
    description: s(raw.description),
    category: s(raw.category),
    path: s(raw.path),
    version: s(raw.version),
    raw,
  };
}

function toEntries(body: unknown): SkillCatalogEntry[] {
  const list = Array.isArray(body)
    ? body
    : ((body as { skills?: unknown[] }).skills ?? []);
  return (list as Record<string, unknown>[]).map(normalizeSkillEntry);
}

/**
 * Fetch the full skills catalog. Prefers the LIVE hub endpoint
 * ({hub}/api/skills — the catalog musebook.trade/skills renders); falls
 * back to the skills repo's catalog.json when the API is unavailable.
 */
export async function fetchSkillsCatalog(
  config: SkillsConfig,
): Promise<SkillCatalogEntry[]> {
  const apiUrl = config.apiUrl ?? `${config.hub.replace(/\/$/, "")}/api/skills`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`Skills API failed: HTTP ${res.status}`);
    return toEntries(await res.json());
  } catch {
    const url = config.catalogUrl ?? DEFAULT_SKILLS_CATALOG_URL;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Skills catalog failed: HTTP ${res.status}`);
    return toEntries(await res.json());
  }
}

/** Search the catalog by slug/name/description/category (client-side). */
export async function searchSkills(
  config: SkillsConfig,
  query: string,
  options: { limit?: number } = {},
): Promise<SkillCatalogEntry[]> {
  const catalog = await fetchSkillsCatalog(config);
  const q = query.trim().toLowerCase();
  const hits = q
    ? catalog.filter((e) =>
        [e.slug, e.name, e.description, e.category]
          .filter((v): v is string => typeof v === "string")
          .some((v) => v.toLowerCase().includes(q)),
      )
    : catalog;
  return hits.slice(0, options.limit ?? 25);
}

/** URL of the install tarball the hub serves for the skills catalog. */
export function skillsTarballUrl(config: SkillsConfig): string {
  return `${config.hub.replace(/\/$/, "")}/clawd-skills.tar.gz`;
}

/** Parsed SKILL.md frontmatter, aligned with the skills repo's format. */
export interface SkillFrontmatter {
  name: string;
  description: string | null;
  /** metadata.source — upstream repo the skill was vendored from, if any. */
  source: string | null;
  /** metadata.documentation URL, if present. */
  documentation: string | null;
  /** metadata.openclaw.requires — { env: string[], bins: string[] }. */
  requires: { env: string[]; bins: string[] } | null;
  /** allowed-tools list, when the skill restricts its tool surface. */
  allowedTools: string[] | null;
  /** Every frontmatter key, unparsed values as raw strings. */
  raw: Record<string, string>;
}

function unquote(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse the YAML frontmatter of a SKILL.md file. Deliberately minimal —
 * it covers the shapes the skills repo actually uses (top-level scalars,
 * the nested metadata.source / metadata.documentation scalars, the
 * metadata.openclaw.requires env/bins lists, and the allowed-tools list)
 * without taking a YAML dependency. Unknown keys are preserved in `raw`.
 */
export function parseSkillFrontmatter(markdown: string): SkillFrontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const raw: Record<string, string> = {};
  let name = "";
  let description: string | null = null;
  let source: string | null = null;
  let documentation: string | null = null;
  let requires: { env: string[]; bins: string[] } | null = null;
  let allowedTools: string[] | null = null;

  let section = ""; // "", "metadata", "openclaw", "requires", "allowed-tools"
  let listKey: "env" | "bins" | null = null;

  for (const line of lines) {
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (top && !/^\s/.test(line)) {
      const [, key, value] = top;
      listKey = null;
      if (key === "name") {
        name = unquote(value);
        section = "";
      } else if (key === "description") {
        description = unquote(value);
        section = "";
      } else if (key === "metadata") {
        section = "metadata";
      } else if (key === "allowed-tools") {
        allowedTools = [];
        section = "allowed-tools";
      } else {
        section = "";
      }
      if (value) raw[key] = value;
      continue;
    }
    if (item) {
      const value = unquote(item[1]);
      if (section === "allowed-tools" && allowedTools) {
        allowedTools.push(value);
      } else if (section === "requires" && requires && listKey) {
        requires[listKey].push(value);
      }
      continue;
    }
    const nested = /^\s+([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested) {
      const [, key, value] = nested;
      if (section === "metadata" && key === "source") source = unquote(value);
      else if (section === "metadata" && key === "documentation") {
        documentation = unquote(value);
      } else if (section === "metadata" && key === "openclaw") section = "openclaw";
      else if (section === "openclaw" && key === "requires") {
        requires = { env: [], bins: [] };
        section = "requires";
      } else if (section === "requires" && (key === "env" || key === "bins")) {
        listKey = key;
        const inline = value.trim();
        if (inline.startsWith("[") && inline.endsWith("]")) {
          const inner = inline.slice(1, -1).trim();
          if (inner && requires) {
            requires[listKey] = inner.split(",").map((v) => unquote(v.trim()));
          }
          listKey = null;
        }
      }
    }
  }
  if (!name) return null;
  return { name, description, source, documentation, requires, allowedTools, raw };
}
