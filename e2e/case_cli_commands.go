package main

import (
	"os"
	"path/filepath"
	"strings"
)

// cliCommands covers the commands an agent runs on its own machine, with no
// server: validate, config and skill show.
var cliCommands = Case{
	ID:    "cli-commands",
	Title: "bug-trail validate, config and skill show work offline with a private config file",
	Files: []string{"e2e/case_cli_commands.go", "e2e/fixtures/invalid-trail.json", "examples"},
	Map:   "e2e/maps/bug-trail.toml",
	Run:   runCliCommands,
}

func runCliCommands(r *Run) {
	bin, ok := r.buildBugTrail()
	if !ok {
		return
	}
	env := r.isolatedEnv()

	out, code := r.cli(bin, "version.log", env, "version")
	r.Check("", "version", "bug-trail version prints a version", code == 0 && strings.TrimSpace(out) != "", short(out))

	examples, _ := filepath.Glob(filepath.Join(r.Root, "examples", "*.json"))
	out, code = r.cli(bin, "validate-examples.log", env, append([]string{"validate"}, examples...)...)
	r.Check("cli-validate", "validate", "validate passes every example trail", len(examples) > 0 && code == 0 && strings.Count(out, "✓") == len(examples), short(out))

	out, code = r.cli(bin, "validate-invalid.log", env, "validate", filepath.Join(r.Root, "e2e", "fixtures", "invalid-trail.json"))
	r.Check("cli-validate", "validate", "validate exits 1 and names the errors of an invalid trail", code == 1 && strings.Contains(out, "error: issue is required"), short(out))

	// config writes only to the file BUG_TRAIL_CONFIG names.
	cfg := filepath.Join(r.Dir, "home", "config.json")
	out, code = r.cli(bin, "config-path.log", env, "config", "path")
	r.Check("cli-config", "config", "config path names the private config file", code == 0 && strings.TrimSpace(out) == cfg, short(out))

	_, code = r.cli(bin, "config-set.log", env, "config", "set", "server", "http://bugs.example.test:4317")
	out, code2 := r.cli(bin, "config-get.log", env, "config", "get", "server")
	r.Check("cli-config", "config", "config set then get returns the server", code == 0 && code2 == 0 && strings.TrimSpace(out) == "http://bugs.example.test:4317", short(out))

	info, err := os.Stat(cfg)
	r.Check("cli-config", "config", "the config file is readable only by its owner (600)", err == nil && info.Mode().Perm() == 0o600, func() string {
		if err != nil {
			return err.Error()
		}
		return info.Mode().Perm().String()
	}())

	out, code = r.cli(bin, "config-bad.log", env, "config", "set", "server", "not-a-url")
	r.Check("cli-config", "config", "config set server refuses a value that is not an http(s) URL", code != 0, short(out))

	out, code = r.cli(bin, "config-list.log", env, "config", "list")
	r.Check("cli-config", "config", "config list shows the stored server and its source", code == 0 && strings.Contains(out, "http://bugs.example.test:4317"), short(out))

	out, code = r.cli(bin, "skill-show.log", env, "skill", "show")
	r.Check("cli-skill", "skill", "skill show prints the embedded guide", code == 0 && strings.Contains(out, "# Bug Trail") && strings.Contains(out, "bug-trail/v2"), short(out))
}
