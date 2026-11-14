# Command reference

Run `bug-trail help` for a summary in the terminal. `bug-trail skill` and `bug-trail config` print
their own help when run without a command, and `serve` and `push` list their flags with `--help`.

| Command | What it does |
|---|---|
| [`serve`](#bug-trail-serve) | Run the dashboard |
| [`push`](#bug-trail-push) | Validate trail files and upload them to a server |
| [`config`](#bug-trail-config) | Store the server, token and trails folder |
| [`skill`](#bug-trail-skill) | Install, check or remove the skill in coding agents |
| [`prompt`](#bug-trail-prompt) | Print a prompt for agents without skill support |
| [`validate`](#bug-trail-validate) | Check trail files against the format |
| `healthcheck [URL]` | Exit 0 if the server answers `/healthz` (used by Docker) |
| `version` | Print the version |

## bug-trail serve

```bash
bug-trail serve [--dir DIR] [--host 127.0.0.1] [--port 4317] [--open]
```

Runs the dashboard and watches `DIR` (default: the configured trails folder) for trail files,
redrawing open pages when one changes. `--host 0.0.0.0` accepts connections from other machines.
With a token [configured](configuration.md), it also accepts uploads from `bug-trail push`.
`--open` opens the dashboard in your browser.

## bug-trail push

```bash
bug-trail push [--server URL] [--token TOKEN] FILE.json [...]
```

Validates each file, then uploads it. The file name without `.json` becomes the trail's id. The
server and token come from the flags, the environment, or the config file. A 401 means the token
is wrong.

## bug-trail config

```bash
bug-trail config list
bug-trail config get KEY
bug-trail config set KEY [VALUE]
bug-trail config unset KEY
bug-trail config path
```

Keys are `server`, `token` and `dir`. `list` shows each value and where it comes from, with the
token masked. `set token` without a value prompts for it without echoing, so it stays out of your
shell history. See [Configuration](configuration.md).

## bug-trail skill

```bash
bug-trail skill status [--project] [--json]
bug-trail skill setup  [--agent AGENT]... [--project] [--dry-run] [--force] [--json]
bug-trail skill remove [--agent AGENT]... [--project] [--dry-run] [--json]
bug-trail skill show
```

| Option | Meaning |
|---|---|
| `--agent AGENT` | Only `claude`, `codex`, `opencode` or `pi` (repeatable). Without it, `setup` uses the agents found and `remove` uses every agent it knows. |
| `--project` | Act on the current git repository (`.claude/skills`, `.agents/skills`) instead of your account. |
| `--dry-run` | Report what would change without changing anything. |
| `--force` | `setup` only: replace a skill named `bug-trail` that bug-trail did not install. |
| `--json` | Print the result as JSON. |

`status` reports each item as `current`, `outdated` (installed by an older bug-trail, or edited
since), `missing`, `foreign` (a skill of the same name that bug-trail didn't install) or
`unreadable`. `remove` only removes what bug-trail installed. `show` prints the guide the skill
gives agents. See [Agents and the skill](agents.md).

## bug-trail prompt

```bash
bug-trail prompt https://github.com/OWNER/REPO/issues/123
```

Prints a prompt that tells any agent to analyze the issue with the bug-trail guide, write the
trail to the trails folder, and validate it.

## bug-trail validate

```bash
bug-trail validate FILE.json [...]
```

Checks files against the [trail format](../skill/bug-trail/FORMAT.md). Exits 1 if any file has
errors; warnings (for example a bug-path step without a code location) don't fail it.
