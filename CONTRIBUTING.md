# Contributing

## Two kinds of skills

Skills in this repo come in two flavours:

1. **Externally-authored** — the skill is authored in another Checkly repo and synced here on release. Listed in [`skills.config.ts`](skills.config.ts). **Do not edit these files in this repo** — your changes will be overwritten the next time the sync runs. Open a PR against the source repo instead.
2. **Plugin-native** — the skill is authored here directly. Anything under `skills/<name>/` that is _not_ listed in `skills.config.ts` falls into this bucket.

For example, the `checkly` skill is externally-authored; it lives at [`checkly/checkly-cli`](https://github.com/checkly/checkly-cli/tree/main/skills/checkly).

> Heads up: in `checkly-cli`, the `skills/` directory at the repo root is itself generated at prepare time from `packages/cli/dist/ai-context/public-skills/`. The package source is the ultimate source of truth, but the synced `skills/<name>/` artifact on a release tag is what we pull from — that's what end users see and it's stable per release.

## Adding an externally-authored skill

1. Add an entry to the `skills` array in `skills.config.ts`:
   ```ts
   {
     name: "<skill-name>",
     source: {
       repo: "<owner>/<repo>",
       path: "<path/to/skill/dir>",
       ref: "<tag-branch-or-sha>",
     },
     files: ["SKILL.md", "README.md"],
   }
   ```
   `ref` is required — every source must be pinned explicitly. Prefer a release tag over a branch so syncs are reproducible.
2. Run `npm run sync` to pull the files locally.
3. Commit `skills.config.ts` and `skills/<skill-name>/` together.

## Adding a plugin-native skill

1. Create `skills/<skill-name>/SKILL.md` with valid frontmatter (at minimum `name` and `description`).
2. Add any references it needs in the same directory.
3. Commit. No `skills.config.ts` entry needed.

## Adding an agent or command

These are listed explicitly in `.claude-plugin/plugin.json` (Claude Code requires file arrays). Cursor and the generic plugin discover them by convention from `agents/` and `commands/` at the repo root.

To add one:

1. Drop the file under `agents/<name>.md` or `commands/<name>.md`.
2. Add the path to the corresponding array in `.claude-plugin/plugin.json`.

## How syncing works

`scripts/sync.ts` reads `skills.config.ts`, fetches each declared file from the ref pinned in `source.ref` via `raw.githubusercontent.com`, and writes it into `skills/<name>/`. There is no transform — what's upstream lands here verbatim.

To bump a synced skill, change its `source.ref` in `skills.config.ts` and run:

```bash
npm run sync
```

The sync also runs in CI via `.github/workflows/sync.yml`, triggered manually with `workflow_dispatch`. The workflow runs `npm run sync` against whatever refs are pinned in `skills.config.ts` and opens a PR if any files changed. CI does not bump the pins — that's a manual edit to `skills.config.ts`.

## Git hooks

`simple-git-hooks` installs two hooks, wired up automatically by the `postinstall` script the first time you run `npm install`:

- `pre-commit` runs `npm run lint`, `npm run format:check`, and `npm run typecheck`.
- `commit-msg` runs `commitlint` against the [Conventional Commits](https://www.conventionalcommits.org/) spec (header capped at 100 chars). See `commitlint.config.js`.

If the pre-commit hook fails on `format:check`, run `npm run format` and re-stage. To bypass the hooks for a single commit (rarely needed), set `SKIP_SIMPLE_GIT_HOOKS=1`.

## Version bumping

Each of the three plugin manifests carries its own `version` field:

- `.claude-plugin/plugin.json`
- `.cursor-plugin/plugin.json`
- `.plugin/plugin.json`

Keep them in sync with the version in `package.json` when cutting a release.
