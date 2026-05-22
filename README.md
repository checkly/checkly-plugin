# checkly-plugin

Checkly skills, agents, and commands for AI coding agents packaged as a single plugin that targets Codex, Claude Code, Cursor, and generic agent SDKs.

## What's in here

```
.codex-plugin/      Codex plugin manifest
.claude-plugin/      Claude Code marketplace + plugin manifest
.cursor-plugin/      Cursor plugin manifest
.plugin/             Generic agent plugin manifest
skills/              Skills (one directory per skill)
scripts/sync.ts      Pulls externally-authored skills from their source repos
skills.config.ts     Declares where each externally-authored skill comes from
```

## Installing

### Codex

```bash
codex plugin marketplace add checkly/checkly-plugin
codex
```

Then open Codex and enable the Checkly plugin via `/plugins`.

```
/plugins
```

### Plugins CLI

```
npx plugins add checkly/checkly-plugin
```

### Claude Code

```
/plugin marketplace add checkly/checkly-plugin
/plugin install checkly@checkly
```

### Cursor

Point Cursor at this repo to install the plugin.

## Skills shipped here

| Skill                      | Source                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [checkly](skills/checkly/) | [checkly/checkly-cli](https://github.com/checkly/checkly-cli/tree/main/skills/checkly) — synced on release |

## Adding more

- **Externally-authored** (lives in another repo, synced here): add an entry to [`skills.config.ts`](skills.config.ts) and run `npm run sync`.
- **Plugin-native** (authored here directly): drop a `skills/<name>/SKILL.md` into the `skills/` directory.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
