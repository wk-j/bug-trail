package skill

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var guide = []byte("---\nname: bug-trail\ndescription: Trace a GitHub issue through the code.\n---\n\n# Bug Trail\n\nThe full guide.\n")

// env builds a fake home; `found` lists agents whose config directory exists.
func env(t *testing.T, found ...string) Env {
	t.Helper()
	home := t.TempDir()
	for _, a := range Agents {
		for _, id := range found {
			if a.ID == id {
				for _, d := range a.ConfigDirs {
					if err := os.MkdirAll(filepath.Join(home, d), 0o755); err != nil {
						t.Fatal(err)
					}
				}
			}
		}
	}
	return Env{Home: home, LookPath: func(string) (string, error) { return "", errors.New("not on PATH") }}
}

func states(r Report) map[string]string {
	out := map[string]string{}
	for _, a := range r.Agents {
		out[a.ID] = a.Items[0].State
	}
	return out
}

func changes(r Result) []string {
	var out []string
	for _, s := range r.Steps {
		out = append(out, strings.Join(s.Agents, "+")+":"+s.Change)
	}
	return out
}

func TestStubCarriesDescriptionAndMarker(t *testing.T) {
	s := string(Stub(guide))
	for _, want := range []string{"name: bug-trail\n", "description: Trace a GitHub issue through the code.\n", Marker, "bug-trail skill show"} {
		if !strings.Contains(s, want) {
			t.Errorf("stub is missing %q:\n%s", want, s)
		}
	}
}

func TestStatusSetupStatus(t *testing.T) {
	e := env(t, "claude", "codex")
	if got := states(Status(e, guide)); got["claude"] != Missing || got["codex"] != Missing {
		t.Fatalf("before setup: %v", got)
	}
	r := Status(e, guide)
	if !r.Agents[0].Detected || !r.Agents[1].Detected || r.Agents[2].Detected {
		t.Fatalf("detection: %+v", r.Agents)
	}

	res, err := Setup(e, guide, Options{})
	if err != nil {
		t.Fatal(err)
	}
	// Claude Code gets its own directory; Codex alone uses the shared one (OpenCode and Pi aren't found).
	if got := strings.Join(changes(res), " "); got != "claude:created codex:created" {
		t.Fatalf("setup: %s", got)
	}
	got := states(Status(e, guide))
	for _, id := range []string{"claude", "codex", "opencode", "pi"} {
		if got[id] != Current { // OpenCode and Pi read the shared directory Codex's copy is in
			t.Errorf("%s after setup: %s", id, got[id])
		}
	}

	res, _ = Setup(e, guide, Options{})
	if got := strings.Join(changes(res), " "); got != "claude:unchanged codex:unchanged" {
		t.Fatalf("second setup should change nothing: %s", got)
	}
}

func TestSharedDirectoryWrittenOnce(t *testing.T) {
	e := env(t, "codex", "opencode", "pi")
	res, _ := Setup(e, guide, Options{})
	if len(res.Steps) != 1 || strings.Join(res.Steps[0].Agents, ",") != "codex,opencode,pi" {
		t.Fatalf("want one shared step for codex, opencode and pi: %+v", res.Steps)
	}
}

func TestNoAgentFoundUsesSharedDirectory(t *testing.T) {
	e := env(t)
	res, _ := Setup(e, guide, Options{})
	if len(res.Steps) != 1 || res.Steps[0].Path != filepath.Join(e.Home, ".agents/skills", Name) || len(res.Steps[0].Agents) != 0 {
		t.Fatalf("want the shared directory only: %+v", res.Steps)
	}
}

func TestAgentFlag(t *testing.T) {
	e := env(t, "claude", "codex")
	res, _ := Setup(e, guide, Options{Agents: []string{"pi"}}) // named agents are used even if not found
	if got := strings.Join(changes(res), " "); got != "pi:created" {
		t.Fatalf("--agent pi: %s", got)
	}
	if _, err := Setup(e, guide, Options{Agents: []string{"cursor"}}); err == nil || !strings.Contains(err.Error(), "unknown agent") {
		t.Fatalf("want an unknown-agent error, got %v", err)
	}
}

func TestOutdatedForeignAndForce(t *testing.T) {
	e := env(t, "claude")
	dir := filepath.Join(e.Home, ".claude/skills", Name)
	if _, err := Setup(e, guide, Options{}); err != nil {
		t.Fatal(err)
	}

	// Edited since install: still ours, so outdated; setup rewrites it.
	_ = os.WriteFile(filepath.Join(dir, "SKILL.md"), append(Stub(guide), "edited\n"...), 0o644)
	if s := State(dir, Stub(guide)); s != Outdated {
		t.Fatalf("edited stub: %s", s)
	}
	res, _ := Setup(e, guide, Options{Agents: []string{"claude"}})
	if changes(res)[0] != "claude:updated" || State(dir, Stub(guide)) != Current {
		t.Fatalf("update: %v", changes(res))
	}

	// A full copy from the old install-skill command: ours, outdated, extra files cleaned up.
	_ = os.WriteFile(filepath.Join(dir, "SKILL.md"), guide, 0o644)
	_ = os.WriteFile(filepath.Join(dir, "FORMAT.md"), []byte("# format"), 0o644)
	if s := State(dir, Stub(guide)); s != Outdated {
		t.Fatalf("old full copy: %s", s)
	}
	_, _ = Setup(e, guide, Options{Agents: []string{"claude"}})
	if _, err := os.Stat(filepath.Join(dir, "FORMAT.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("old FORMAT.md was left behind")
	}

	// Someone else's skill with the same name: conflict unless --force.
	_ = os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("---\nname: bug-trail\n---\nnot ours\n"), 0o644)
	if s := State(dir, Stub(guide)); s != Foreign {
		t.Fatalf("foreign: %s", s)
	}
	res, _ = Setup(e, guide, Options{Agents: []string{"claude"}})
	if changes(res)[0] != "claude:conflict" || State(dir, Stub(guide)) != Foreign {
		t.Fatalf("conflict should leave it alone: %v", changes(res))
	}
	res, _ = Setup(e, guide, Options{Agents: []string{"claude"}, Force: true})
	if changes(res)[0] != "claude:replaced" || State(dir, Stub(guide)) != Current {
		t.Fatalf("--force: %v", changes(res))
	}
}

func TestDryRunChangesNothing(t *testing.T) {
	e := env(t, "claude")
	res, _ := Setup(e, guide, Options{DryRun: true})
	if !res.DryRun || changes(res)[0] != "claude:created" {
		t.Fatalf("dry run: %+v", res)
	}
	if s := State(filepath.Join(e.Home, ".claude/skills", Name), Stub(guide)); s != Missing {
		t.Fatalf("dry run wrote the skill: %s", s)
	}
}

func TestRemoveOnlyOurs(t *testing.T) {
	e := env(t, "claude", "codex")
	_, _ = Setup(e, guide, Options{})
	// Codex's copy is replaced by someone else's skill of the same name.
	shared := filepath.Join(e.Home, ".agents/skills", Name)
	_ = os.WriteFile(filepath.Join(shared, "SKILL.md"), []byte("someone else's"), 0o644)

	res, _ := Remove(e, guide, Options{DryRun: true})
	if got := strings.Join(changes(res), " "); got != "claude:removed codex+opencode+pi:skipped" {
		t.Fatalf("remove dry run: %s", got)
	}
	if State(filepath.Join(e.Home, ".claude/skills", Name), Stub(guide)) != Current {
		t.Fatal("dry run removed the skill")
	}

	_, _ = Remove(e, guide, Options{})
	if s := State(filepath.Join(e.Home, ".claude/skills", Name), Stub(guide)); s != Missing {
		t.Fatalf("claude after remove: %s", s)
	}
	if b, _ := os.ReadFile(filepath.Join(shared, "SKILL.md")); string(b) != "someone else's" {
		t.Fatal("remove touched a skill bug-trail did not install")
	}

	res, _ = Remove(e, guide, Options{Agents: []string{"claude"}})
	if len(res.Steps) != 0 {
		t.Fatalf("nothing left to remove, got %v", changes(res))
	}
}

func TestProjectScope(t *testing.T) {
	e := env(t, "claude")
	e.Project, e.Root = true, t.TempDir()
	res, _ := Setup(e, guide, Options{})
	if res.Scope != "project" || res.Steps[0].Path != filepath.Join(e.Root, ".claude/skills", Name) {
		t.Fatalf("project setup: %+v", res)
	}
	if s := State(filepath.Join(e.Home, ".claude/skills", Name), Stub(guide)); s != Missing {
		t.Fatalf("project setup touched the account: %s", s)
	}
}
