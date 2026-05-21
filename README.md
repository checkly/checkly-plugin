# checkly-plugin

Checkly skills, agents, and commands for AI coding agents packaged as a single plugin that targets Claude Code, Cursor, and generic agent SDKs.

## What's in here

```
.claude-plugin/      Claude Code marketplace + plugin manifest
.cursor-plugin/      Cursor plugin manifest
.plugin/             Generic agent plugin manifest
skills/              Skills (one directory per skill)
scripts/sync.ts      Pulls externally-authored skills from their source repos
skills.config.ts     Declares where each externally-authored skill comes from
```

## Installing

### Claude Code

```
/plugin marketplace add checkly/checkly-plugin
/plugin install checkly@checkly
```

### Cursor

Point Cursor at this repo per the Cursor plugin docs — `.cursor-plugin/plugin.json` is the manifest.

### Other agents

Most agent runtimes that follow the conventional `skills/` layout will pick up the skills directly from this repo's root. See `.plugin/plugin.json` for the generic manifest.

## Skills shipped here

| Skill                      | Source                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [checkly](skills/checkly/) | [checkly/checkly-cli](https://github.com/checkly/checkly-cli/tree/main/skills/checkly) — synced on release |

## Adding more

- **Externally-authored** (lives in another repo, synced here): add an entry to [`skills.config.ts`](skills.config.ts) and run `npm run sync`.
- **Plugin-native** (authored here directly): drop a `skills/<name>/SKILL.md` into the `skills/` directory.

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.
