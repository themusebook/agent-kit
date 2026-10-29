import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSkillsCatalog,
  normalizeSkillEntry,
  parseSkillFrontmatter,
  searchSkills,
} from "../src/skills";

const config = { hub: "https://musebook.trade" };

// Frontmatter shape as shipped in themusebook/skills (skills/ask-mcp/SKILL.md).
const askMcp = `---
name: ask-mcp
description: "For questions about Light Protocol's SDK and agent skills."
metadata:
  source: https://github.com/Lightprotocol/skills
  documentation: https://www.zkcompression.com
  openclaw:
    requires:
      env: []
      bins: []
allowed-tools:
  - Read
  - Glob
  - WebSearch
---

# DeepWiki Research
`;

describe("parseSkillFrontmatter", () => {
  it("parses the repo's SKILL.md frontmatter shape", () => {
    const fm = parseSkillFrontmatter(askMcp);
    expect(fm).not.toBeNull();
    expect(fm?.name).toBe("ask-mcp");
    expect(fm?.description).toBe(
      "For questions about Light Protocol's SDK and agent skills.",
    );
    expect(fm?.source).toBe("https://github.com/Lightprotocol/skills");
    expect(fm?.documentation).toBe("https://www.zkcompression.com");
    expect(fm?.requires).toEqual({ env: [], bins: [] });
    expect(fm?.allowedTools).toEqual(["Read", "Glob", "WebSearch"]);
  });

  it("parses the minimal shape (name + description only)", () => {
    const fm = parseSkillFrontmatter(
      "---\nname: clawd\ndescription: Do clawd things.\n---\n# Clawd\n",
    );
    expect(fm?.name).toBe("clawd");
    expect(fm?.source).toBeNull();
    expect(fm?.allowedTools).toBeNull();
  });

  it("returns null without frontmatter or a name", () => {
    expect(parseSkillFrontmatter("# No frontmatter\n")).toBeNull();
    expect(parseSkillFrontmatter("---\ndescription: x\n---\n")).toBeNull();
  });
});

describe("skills catalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes the repo catalog.json entry shape", () => {
    const e = normalizeSkillEntry({
      slug: "anthropic-skills/claude-api",
      name: "claude-api",
      description: "Reference for the Claude API.",
      category: "Solana / Blockchain",
    });
    expect(e.slug).toBe("anthropic-skills/claude-api");
    expect(e.category).toBe("Solana / Blockchain");
  });

  it("prefers the live hub API shape ({hub}/api/skills, with path/version)", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        seen.push(url);
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              category: "General",
              description: "Set up and use 1Password CLI (op).",
              name: "1password",
              path: "1password/SKILL.md",
              slug: "1password",
              version: null,
            },
          ],
        };
      }),
    );
    const entries = await fetchSkillsCatalog(config);
    expect(seen[0]).toBe("https://musebook.trade/api/skills");
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("1password/SKILL.md");
    expect(entries[0].version).toBeNull();
    expect(entries[0].category).toBe("General");
  });

  it("falls back to the repo catalog.json when the live API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/skills")) {
          return { ok: false, status: 404, json: async () => ({}) };
        }
        return {
          ok: true,
          status: 200,
          json: async () => [
            { slug: "ask-mcp", name: "ask-mcp", description: "DeepWiki answers.", category: "Solana / Blockchain" },
          ],
        };
      }),
    );
    const entries = await fetchSkillsCatalog(config);
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("ask-mcp");
    expect(entries[0].path).toBeNull();
  });

  it("searches the flat catalog list client-side", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => [
          { slug: "ask-mcp", name: "ask-mcp", description: "DeepWiki answers.", category: "Solana / Blockchain" },
          { slug: "bird", name: "bird", description: "Twitter CLI.", category: "Utilities" },
        ],
      })),
    );
    const hits = await searchSkills(config, "deepwiki");
    expect(hits).toHaveLength(1);
    expect(hits[0].slug).toBe("ask-mcp");
    const all = await searchSkills(config, "");
    expect(all).toHaveLength(2);
  });
});
