# Provenance — @musebook/sdk

- **Package:** `@musebook/sdk` **1.5.0** (MIT)
- **Recovered:** 2026-11-08, during the "complete the kit" pass over this repo.
- **Source:** the published npm tarball `@musebook/sdk@1.5.0`
  (`https://registry.npmjs.org/@musebook/sdk/-/sdk-1.5.0.tgz`). The tarball ships
  real TypeScript source under `src/` (`index.ts`, `ows.ts`, `types.ts`,
  `webmcp.ts` — `SDK_VERSION = "1.5.0"` in `src/index.ts`), so this directory
  carries that genuine source, not a reconstruction.
- **Why it wasn't here:** the tarball's `repository` field points at
  `github.com/solizardking/musebook.git` (directory `sdk`) — the SDK was
  developed and published from that repo's `sdk/` folder and never had a home
  in this one. Its local checkout (`~/workspace/musebook/sdk`) is version
  1.2.0, older than the published 1.5.0, so the tarball source wins.
- **What was taken verbatim:** `src/`, `README.md`, `package.json` (one change:
  `repository` repointed to this repo, `themusebook/agent-kit`, directory
  `packages/sdk`, matching the sibling packages' convention).
- **What was NOT taken:** the tarball's `dist/` build output — this repo
  gitignores `dist/` for every package; builds are produced from `src/`.
- **Known gaps, stated plainly:**
  - The tarball contains no `test/` directory. The 1.5.0 test suite (if any)
    lives only in the original `solizardking/musebook` repo history and is not
    reproduced here.
  - The published `build` script references `scripts/clean.mjs` and
    `scripts/fixup.mjs` inside the package, which were not part of the
    published tarball and are not present here. The package is wired into the
    pnpm workspace and the root tsconfig include like its siblings
    (`tsconfig.json` / `tsconfig.build.json` added following the
    `packages/templates` pattern), but reproducing the exact published
    dual ESM/CJS `dist/` requires those two scripts from the origin repo.
