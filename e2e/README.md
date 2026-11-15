# bug-trail end-to-end tests

These cases test bug-trail as a user runs it. Each run builds the binary from the working tree,
then drives it only through what a user has: the CLI and HTTP. They never import the app's
packages; the Go tests under `internal/` stay unit tests.

```sh
go run ./e2e list                   # the cases, as JSON
go run ./e2e run serve-and-push     # serve + push + API + live reload
go run ./e2e run cli-commands       # validate, config, skill show (no server)
go run ./e2e history                # every kept run, as JSON
```

- Every run runs the binary with its own config file (`BUG_TRAIL_CONFIG` in the run folder) and
  none of your `BUG_TRAIL_*` variables, so your settings are never read or changed.
- `serve-and-push` starts `bug-trail serve` on a free loopback port with a fresh trails folder and
  a random token. No network, no secrets.
- Verdicts: `PASS`, `FAIL` (a check did not hold), `BLOCKED` (Go missing), `ERROR` (the harness
  broke). The exit code is 0 only for `PASS`.
- Evidence stays in `e2e/runs/<caseId>/<runId>/` (git-ignored): `build.log`, `server.log`, the CLI
  output of each command, `responses/` and `result.json`.

## Publishing to valence

The runner implements the Krypton E2E Adapter Contract v1 (`.krypton/e2e/project.toml` points
at `go run ./e2e`, with `history = true`), so a [valence](https://github.com/wk-j/valence)
server can show the runs:

```sh
valence check   # what would be sent, and what the report would miss
valence push    # uploads runs the server does not have yet
```

## Adding a case

Add `e2e/case_<slug>.go` with a `Case` and its run function, and add it to `cases` in
`e2e/main.go`. Write one `r.Check(at, group, label, ok, detail)` per expected result, where `at`
is a node of `e2e/maps/bug-trail.toml`; add a node there when a check proves a part the map lacks.
