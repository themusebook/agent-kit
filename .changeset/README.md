# Changesets

Run `pnpm changeset` to record a version bump for the `@musebook/*` packages in the pnpm workspace.
`packages/cli` (npm-managed) and `agents/trading` (bun-managed) are versioned by hand and published by the same release workflow.
Nothing is published until a maintainer runs the **Release** workflow manually and approves the `npm-publish` environment.
