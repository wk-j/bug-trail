# Bug Trail

Map one GitHub bug from the first report to the verified fix.

Bug Trail is a single Go binary with two jobs:

1. **It ships a skill** (`skill/bug-trail/`, embedded in the binary) that any agent can follow.
   The agent reads the issue, its comments, linked PRs and commits, works out the story, and writes
   one JSON file in the [`bug-trail/v1` format](skill/bug-trail/FORMAT.md).
2. **It runs a local dashboard** that watches the folder those files go into and draws each one as
   a map: six columns (Reported → Observed → Investigated → Root cause → Resolution → Verified),
   with arrows for how each step led to the next. Ruled-out ideas stay on the map, struck through.

The binary never calls an AI model itself. Any agent (Claude Code, Codex, Cursor, your own script)
writes the file; the dashboard only reads it.

## Requirements

Go 1.24 or later to build. No other dependencies. Agents also need the GitHub CLI (`gh`), logged in.

## Quick start

```bash
go install .                  # builds bug-trail into $(go env GOPATH)/bin
```

Or, without cloning (for a private repo, set `GOPRIVATE=github.com/wk-j/*` first):

```bash
go install github.com/wk-j/bug-trail@latest
```

```bash
bug-trail install-skill       # writes the skill to ~/.claude/skills/bug-trail
bug-trail serve --open        # dashboard on http://localhost:4317
```

Then ask your agent:

> Use the bug-trail skill to analyze https://github.com/OWNER/REPO/issues/123

The map appears in the dashboard as soon as the agent saves the file, and updates when the agent
rewrites it.

To see the examples without running an agent: `bug-trail serve --dir examples`.

## Commands

| Command | What it does |
|---|---|
| `bug-trail serve [--dir DIR] [--port N] [--open]` | Run the dashboard and watch `DIR` for trail files. |
| `bug-trail install-skill [--project PATH \| --to DIR]` | Install the skill globally, into a project's `.claude/skills`, or into another agent's skills folder. |
| `bug-trail skill` | Print the skill and format docs, for agents without skill support. |
| `bug-trail prompt <issue-url>` | Print a ready-to-paste prompt for any agent. |
| `bug-trail validate <file.json>…` | Check files against the format. |

Trail files live in `~/.bug-trail/trails/` by default. Set `BUG_TRAIL_DIR` to change it; the
skill tells agents to use the same variable.

The web UI and the skill are embedded with `go:embed`, so after editing anything under `web/` or
`skill/`, rebuild (`go install .`) and, for skill changes, run `bug-trail install-skill` again.

## Using the map

- **Click a step** to see its detail, its sources on GitHub and what it connects to.
- **Start story** walks the main storyline (the trail's `story` list) one step at a time.
- **Hover** a step to highlight its direct connections; hover an arrow to read the relation.
- **Timeline** lists every dated step in order; click one to jump to it on the map.

## Layout

```
main.go                       CLI, embeds web/ and skill/
internal/format/              bug-trail/v1 definitions + validator (also served to the browser as /format.js)
internal/server/              HTTP server, folder watcher, live reload (server-sent events)
web/                          dashboard (vanilla JS, no build step)
skill/bug-trail/SKILL.md      instructions for the agent
skill/bug-trail/FORMAT.md     the bug-trail/v1 format
examples/                     a fictional example and a real one (cli/cli#14394) written by the skill
```
