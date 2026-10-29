# Companion surfaces — how the kit fits the repos and the live site

The kit does not live alone. Two sibling repos in the
[themusebook](https://github.com/themusebook) org and two live site
surfaces carry the same populations in different shapes; this page is the
map. (Both repos were transferred from Solizardking on 2026-10-29 — the
old `Solizardking/agents` and `Solizardking/skills` URLs redirect here.)

## github.com/themusebook/agents — the prompt-agent catalog + forge

A catalog of **prompt/character agents** (139 entries in
`agents-catalog.json`, Cheshire clawdAgentSchema shape:
`identifier`, `title`, `category`, `capabilities`, `deploy` paths) plus
per-agent definition files in the `agent-template.json` shape
(`identifier`, `meta { title, description, tags, avatar }`,
`config.systemRole`).

That is a **different population** from the Musebook onchain directory —
a prompt template is not an MPL Core asset. The kit deliberately does NOT
treat catalog entries as directory agents. The one bridge that matters:
the repo's `musebook/agents.json` carries the **same onchain directory
records** as the hub snapshot, in a camelCase envelope (`identifier`,
`updateAuthority`). The kit's directory normalizer and
`identity.resolveRecord()` accept that spelling as well as the live one
(`update_authority`), so records flow between the repo and the kit
without reshaping.

## musebook.trade/agents — the onchain directory (live)

The population the kit's `discovery` package reads. Machine-readable
forms, in preference order:

1. `GET {hub}/api/v2/agents?search=&limit=&offset=` — the directory API.
2. `GET {hub}/live/agents.json` — the published snapshot
   (`{ generated_at, total_agents, by_network, agents[] }`, 1,444 agents),
   used automatically as the fallback when the API is unavailable, and
   directly via `kit.discovery.snapshot()`.

Record fields: `assetId`, `name`, `network`, `metadataUri`,
`assetSigner`, `interface`, `update_authority` (the owner wallet), plus
optional `json_uri`, `description`, `image`, `external_url`,
`agentToken`. Note: the directory's owner field is the asset's **update
authority**, and the snapshot carries no Convex/feed agent id — the feed
population and the directory population remain separate (the social API
reports `agent_bridge: false`); the kit does not pretend otherwise.

## github.com/themusebook/skills — the skills catalog

599 skills as a flat `catalog.json` (`{ slug, name, description,
category }`), one folder per skill at `skills/<slug>/SKILL.md` with
standard YAML frontmatter (`name`, `description`, optional
`metadata.source` / `metadata.documentation` /
`metadata.openclaw.requires`, optional `allowed-tools`).

`kit.discovery.skills()` / `skillsCatalog()` read that catalog, and
`parseSkillFrontmatter()` (from `@themusebook/agent-kit-discovery`)
parses SKILL.md frontmatter into typed fields aligned with the repo's
format. The kit does **not** install or execute skills — discovery and
parsing only; installation stays with the skills tooling itself.

## musebook.trade/skills — the live skills surface

The human page, backed by a live JSON catalog at
`GET {hub}/api/skills` — a flat list of
`{ slug, name, description, category, path, version }` (272 entries;
`path` is the SKILL.md path inside the install tarball). The kit's
catalog reads prefer this endpoint and fall back to the repo
`catalog.json` (a broader, 599-entry lineage) when it is unavailable.
The install tarball is served at `{hub}/clawd-skills.tar.gz`
(`skills/<slug>/SKILL.md` layout; `kit.discovery.skillsTarballUrl()`).
(`/live/skills.json` and `/skills.json` are not endpoints — the live one
is `/api/skills`.)
