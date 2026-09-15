# pi-hub-cli

Manage [pi](https://pi.dev) coding agent profiles: provider, model(s), thinking level, API token, and base URL — switched at launch, exactly like [cc-hub](https://github.com/sherocktong/cc-hub) does for Claude Code.

## Install

```bash
npm install -g pi-hub-cli
# or from source:
npm link
```

Requires the `pi` CLI on your PATH (`npm i -g @earendil-works/pi-coding-agent`) and Node.js >= 18.

## Quick start

```bash
# Add a profile (provider id from `pi` — e.g. kimi-coding, anthropic, openai, google)
pi-hub profile add work -p kimi-coding -m kimi-for-coding -t "$KIMI_API_KEY" --thinking high

# Multiple models (max 3): the first is the default
pi-hub profile add oss -p anthropic -m claude-sonnet-4-6 -m claude-haiku-4-5 -t "$ANTHROPIC_API_KEY"

# A profile pointing at a custom base URL (works for ANY provider)
pi-hub profile add px -p kimi-coding -m kimi-for-coding -t "$TOKEN" -u https://proxy.example.com/coding

# Make it the default
pi-hub use work          # or: pi-hub profile default work

# Launch pi with a profile
pi-hub run work
pi-hub run               # default profile
pi-hub run work -p "explain this repo"   # extra args pass through to pi
pi-hub run --built-in    # plain pi with your existing ~/.pi/agent config
```

## How it works

`pi` has no `--base-url` flag, and most providers (e.g. `kimi-coding`) have no `*_BASE_URL` env var. So instead of env injection, `pi-hub run`:

1. Materializes an isolated pi config dir at `~/.pi/pi-hub/profiles/<name>/`:
   - `auth.json` (0600) — `{ "<provider>": { "type": "api_key", "key": "<token>" } }`
   - `settings.json` — your current `~/.pi/agent/settings.json` with `defaultProvider` / `defaultModel` / `defaultThinkingLevel` overridden by the profile
   - `models.json` — `providers.<provider>.baseUrl` override (only when the profile has a URL; this is pi's documented mechanism and works even for built-in providers)
   - symlinks to your shared `extensions/`, `skills/`, `npm/`, `sessions/`, `AGENTS.md`, `models-store.json`
2. Launches `pi` with `PI_CODING_AGENT_DIR` pointing at that dir.

Consequences:

- **Sessions stay shared** — everything pi writes to `sessions/` lands in your real `~/.pi/agent/sessions/`, whichever profile you run.
- **Extensions/skills stay live** — they're symlinks, not copies, and are refreshed on every run.
- **No credential shadowing** — pi's auth.json outranks env vars; per-profile dirs ensure the profile token is the only auth source.
- `pi-hub run --built-in` (or default = `__builtin__`) unsets `PI_CODING_AGENT_DIR` and runs plain `pi` against your existing config — zero interference.

## Commands

### `pi-hub profile`

| Subcommand | Description |
|---|---|
| `add <name>` | Add or update a profile. Options: `-p/--provider`, `-m/--model` (repeatable, max 3), `-t/--token`, `-u/--url`, `--thinking`, `--set key=value` (repeatable), `--unset key` (repeatable) |
| `update <name>` | Update an existing profile. Same options plus `-d/--delete-model` (repeatable) |
| `list` | Table of profiles (`*` marks the default; tokens masked) |
| `view <name>` | Full details, token unmasked. `-j/--json` for machine output |
| `remove <name>` | Remove profile + its materialized dir |
| `rename <old> <new>` | Rename profile + its materialized dir |
| `default [name]` | Set default profile (`--built-in` for your existing pi config) |

Thinking levels: `off | minimal | low | medium | high | xhigh | max`.

### `pi-hub use [name] [--built-in]`

Alias for `pi-hub profile default`.

### `pi-hub run [name] [args...]`

Launches `pi`. The first argument matching a profile name selects it; otherwise the default profile is used and all arguments pass through to `pi`.

## Profiles file

`~/.pi/profiles.json` (mode 0600):

```json
{
  "profiles": {
    "work": {
      "provider": "kimi-coding",
      "model": "kimi-for-coding",
      "models": ["kimi-for-coding"],
      "thinking": "high",
      "token": "sk-...",
      "url": "https://proxy.example.com/coding",
      "settings": {
        "theme": "dark",
        "someGlobalHook": null
      }
    }
  },
  "default": "work"
}
```

`"default": "__builtin__"` means "no profile — run plain pi".

### Per-profile settings overrides

Each run, pi-hub regenerates the profile's `settings.json` from your source `~/.pi/agent/settings.json` — hand-edits to the materialized copy are overwritten. To persist per-profile settings, use `--set`/`--unset` (or the `settings` key in `profiles.json`):

```bash
pi-hub profile update work --set theme=dark --set 'maxTokens=8192' --set someGlobalHook=null
```

- Values are parsed as JSON when possible (`true`, `8192`, `"quoted"`, `{...}`), otherwise kept as strings.
- Merged shallowly over the source agent settings; the `provider`/`model`/`thinking` fields still win for their own keys.
- A `null` value **deletes** the key from the materialized `settings.json` — the way to drop a global setting for one profile.

## Config path overrides

| Path | Default | Env override |
|---|---|---|
| Profiles file | `~/.pi/profiles.json` | `PI_HUB_PROFILES_FILE` |
| pi dir | `~/.pi` | `PI_HUB_PI_DIR` |
| Source agent dir | `~/.pi/agent` | `PI_CODING_AGENT_DIR` (same variable pi itself uses) |
| pi-hub state | `~/.pi/pi-hub/` | `PI_HUB_DIR` |

## Shell completion

```bash
pi-hub completion zsh > "${fpath[1]}/_pi-hub"   # zsh
pi-hub completion bash > /etc/bash_completion.d/pi-hub   # bash
```

## Logging

Logs go to `~/.pi/pi-hub/logs/pi-hub-YYYY-MM-DD.log`. Default level is `INFO`; pass `--verbose` or set `PI_HUB_LOG_LEVEL=DEBUG`.

## Development

```bash
npm install
npm test          # vitest (unit + integration, incl. fake-pi runner tests)
npm run build     # tsup → dist/index.js
npm link          # install locally
```

A bundled pi skill for natural-language profile management lives in [`skills/pi-hub/SKILL.md`](skills/pi-hub/SKILL.md).

## License

MIT
