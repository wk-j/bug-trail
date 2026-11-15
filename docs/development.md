# Development

bug-trail is one Go binary with no dependencies outside the standard library. The web UI is plain
JavaScript modules with no build step.

## Layout

```
main.go, skillcmd.go, configcmd.go   CLI; embeds web/ and skill/
internal/format/     trail format definitions and validator (also served to the browser as /format.js)
internal/server/     HTTP server, folder watcher, live reload (server-sent events), upload API
internal/skill/      installs, reports on and removes the skill in coding agents
internal/config/     config file and how settings are resolved
skill/bug-trail/     the guide (SKILL.md) and the trail format (FORMAT.md) printed to agents
web/                 the dashboard
  app.js             routing and live reload
  lib/               helpers, trail model, shared state, glossary links
  ui/                reusable components, one module and one stylesheet each, on tokens.css
  map/board.js       lays out and draws the code-flow map from ui components
  pages/             the list and trail pages, composed from components
e2e/                 end-to-end cases: build the binary, drive the CLI and HTTP (see e2e/README.md)
examples/            a fictional trail and a real one (cli/cli#14394) written by the skill
docs/                these pages
.goreleaser.yaml     release builds and the Homebrew cask (see releasing.md)
```

## Rules of thumb

- `internal/format/format.go` is the source of truth for the format's enums and validation. The
  dashboard reads the same definitions from `/format.js`. Change them in Go and keep
  `skill/bug-trail/FORMAT.md` in step.
- Build UI from components in `web/ui/`: add or extend a component rather than styling something
  inside a page. Materials (paper, cork, yarn, stamps) are tokens in `web/ui/tokens.css`.
- Motion is part of each component's stylesheet, on the timing, easing and distance tokens in
  `tokens.css`; reduced motion zeroes the distances so only fades remain. Entrances play only while
  the root has `data-enter` (a page being opened), and `lib/motion.js` sends page changes and live
  redraws through the View Transitions API where the browser has it.
- The map names no font family, so the browser picks fonts for any language, Thai included.
- `web/` and `skill/` are embedded with `go:embed`: rebuild after editing them. Agents get the new
  guide from the rebuilt binary through `bug-trail skill show`, with nothing to reinstall.

## Checks

```bash
go vet ./... && go test ./... && go run . validate examples/*.json
```

End-to-end cases (build the binary, run `serve`, drive `push` and the API):

```bash
go run ./e2e run serve-and-push && go run ./e2e run cli-commands
```

To look at the examples in the dashboard:

```bash
go run . serve --dir examples --open
```
