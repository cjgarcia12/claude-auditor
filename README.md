# claude-auditor

A dependency-free Node.js CLI that scans Claude Desktop/Code MCP config files for fragmentation: the same server defined differently across files, harmless exact duplicates, and broken references (a command not on `PATH`/not executable, or an arg path that doesn't exist).

No install, no dependencies — just Node.js 18+.

## Usage

```sh
node claude-auditor.cjs
```

It checks the known config locations by default:

- `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
- `~/.config/Claude/claude_desktop_config.json` (Linux)
- `%APPDATA%/Claude/claude_desktop_config.json` (Windows)
- `~/.claude.json` (including per-project `projects[path].mcpServers`)
- `./.claude/settings.json`, `./.claude/settings.local.json`
- `./.mcp.json`

Options:

```
claude-auditor.cjs [--home DIR] [--project DIR] [--config FILE ...]
```

Passing `--config` one or more times replaces location discovery with exactly the files you list.

Exit codes: `0` clean, `1` findings, `2` usage error.

## What it doesn't do (yet)

- No "defined but not referenced" check — doesn't map onto Claude's config format (`mcpServers` has no separate enabled/referenced list).
- No client precedence/effective-config resolution — doesn't say which config wins when several apply.
- No JSONC/comment support, no live URL connectivity checks, no Windows `PATHEXT` testing.

## Secrets note

`env` values are redacted in reports. `command`/`args`/`url` values are printed raw when they differ across files — a report could expose an inline secret in one of those fields, so keep reports private.
