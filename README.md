# Bug Trail

Map one GitHub bug from the first report to the verified fix.

Bug Trail is a single Go binary with two jobs:

1. **It ships a skill** (`skill/bug-trail/`, embedded in the binary) that any agent can follow.
   The agent reads the issue, its comments, linked PRs and commits, works out the story, and writes
   one JSON file in the [`bug-trail/v1` format](skill/bug-trail/FORMAT.md).
2. **It runs a local dashboard** that watches the folder those files go into and draws each one as
   a **code-flow map**. Columns are the parts of the system (app, libraries, services, storage),
   and steps run in execution order with the file and function behind each. The map marks where
   the bug starts, how it spreads, where the user sees it, and where the fix landed. The
   investigation (hypotheses, evidence, PRs) sits below as a timeline.

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

## Deploy as a shared server (Docker Compose)

Run one dashboard for the whole team. Agents on any machine upload their trails to it.

```bash
cp .env.example .env
# set BUG_TRAIL_TOKEN in .env, for example to the output of: openssl rand -hex 32
docker compose up -d --build
```

The dashboard is on port 4317. Trails live in the `trails` Docker volume, so they survive restarts
and upgrades.

On each machine where an agent runs, install `bug-trail` and the skill, then point it at the
server:

```bash
export BUG_TRAIL_SERVER=http://your-server:4317
export BUG_TRAIL_TOKEN=the-token-from-.env
```

With `BUG_TRAIL_SERVER` set, the skill writes the trail locally, validates it, and uploads it with
`bug-trail push`. You can push files by hand too: `bug-trail push trails/*.json`.

**What the server exposes.** Reading (the dashboard and `GET /api/…`) is open to anyone who can
reach the port. Writing (`PUT` and `DELETE /api/trails/{id}`) needs the bearer token, and the
server rejects files with format errors. If the trails should be private, put the server behind a
reverse proxy that adds TLS and login (Caddy, nginx, Traefik, Cloudflare Access, a VPN). Set
`BUG_TRAIL_BIND=127.0.0.1` in `.env` so only that proxy can reach it. Live updates use server-sent
events, so turn off response buffering for `/events` in the proxy.

The image is a static binary on `distroless/static:nonroot`, with no shell, running as a
non-root user and a read-only root filesystem. `bug-trail healthcheck` drives the Docker health
check.

| Endpoint | Auth | |
|---|---|---|
| `GET /api/trails` | – | list trails |
| `GET /api/trails/{id}` | – | one trail plus its validation result |
| `PUT /api/trails/{id}` | Bearer token | create (201) or replace (200); 422 if invalid |
| `DELETE /api/trails/{id}` | Bearer token | remove (204) |
| `GET /events` | – | server-sent events, `data: {"id": …}` on every change |
| `GET /healthz` | – | health check |

## Commands

| Command | What it does |
|---|---|
| `bug-trail serve [--dir DIR] [--host ADDR] [--port N] [--open]` | Run the dashboard and watch `DIR` for trail files. With `BUG_TRAIL_TOKEN` set, it also accepts uploads. |
| `bug-trail push [--server URL] [--token T] <file.json>…` | Validate files and upload them to a server (`BUG_TRAIL_SERVER`, `BUG_TRAIL_TOKEN`). |
| `bug-trail install-skill [--project PATH \| --to DIR]` | Install the skill globally, into a project's `.claude/skills`, or into another agent's skills folder. |
| `bug-trail skill` | Print the skill and format docs, for agents without skill support. |
| `bug-trail prompt <issue-url>` | Print a ready-to-paste prompt for any agent. |
| `bug-trail validate <file.json>…` | Check files against the format. |

Trail files live in `~/.bug-trail/trails/` by default. Set `BUG_TRAIL_DIR` to change it; the
skill tells agents to use the same variable.

The web UI and the skill are embedded with `go:embed`, so after editing anything under `web/` or
`skill/`, rebuild (`go install .`) and, for skill changes, run `bug-trail install-skill` again.

## Using the map

- **Starts in / Seen as** chips at the top jump straight to the origin and the symptom.
- **Follow the bug** walks the bug path from origin to symptom, one step at a time.
- **Click a step** to open its details: file and line, the code snippet, why it matters, the fix,
  and links to GitHub. Esc or ✕ closes it.
- **Hover** a step to highlight what calls it and what it calls.
- Links like `#/t/<trail>/<step>` open a trail with that step selected.

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
