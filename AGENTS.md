# Agent notes

- Repository layout, UI rules and checks: [docs/development.md](docs/development.md).

- To analyze a GitHub issue into a bug trail, follow `skill/bug-trail/SKILL.md`. The format is in
  `skill/bug-trail/FORMAT.md`.
- `internal/format/format.go` is the source of truth for enums and validation. The dashboard gets
  the same definitions from the server at `/format.js`, so change them only in Go and keep
  FORMAT.md in step.
- `web/` and `skill/` are embedded into the binary: rebuild after editing them.
- Checks: `go vet ./... && go test ./... && go run . validate examples/*.json`.
- `skill/bug-trail/` is embedded and printed by `bug-trail skill show`; agents get a short stub
  (`internal/skill`) that runs that command, so guide changes ship with the binary.
