// Package skill installs, reports on and removes the bug-trail skill in coding agents
// (Claude Code, Codex, OpenCode, Pi), the way `rex skill` does for Rex.
//
// The installed skill is a short stub. It tells the agent to run `bug-trail skill show`, which
// prints the full guide from this binary, so upgrading bug-trail updates what agents read
// without reinstalling anything.
package skill

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
)

// Name is the skill's directory name and frontmatter name.
const Name = "bug-trail"

// Marker identifies a skill that bug-trail installed. It is a comment line in SKILL.md.
const Marker = "<!-- Installed by bug-trail."

// Agent is a coding agent that can hold the skill.
type Agent struct {
	ID   string
	Name string
	// Skills directory relative to the home directory (user scope) and to the repository root
	// (project scope).
	UserDir    string
	ProjectDir string
	// Config directories (relative to home) and commands whose presence means "found".
	ConfigDirs []string
	Commands   []string
}

// Agents in the order they are reported. Claude Code reads its own directory; the others share
// ~/.agents/skills, which is written once.
var Agents = []Agent{
	{ID: "claude", Name: "Claude Code", UserDir: ".claude/skills", ProjectDir: ".claude/skills", ConfigDirs: []string{".claude"}, Commands: []string{"claude"}},
	{ID: "codex", Name: "Codex", UserDir: ".agents/skills", ProjectDir: ".agents/skills", ConfigDirs: []string{".codex"}, Commands: []string{"codex"}},
	{ID: "opencode", Name: "OpenCode", UserDir: ".agents/skills", ProjectDir: ".agents/skills", ConfigDirs: []string{".config/opencode"}, Commands: []string{"opencode"}},
	{ID: "pi", Name: "Pi", UserDir: ".agents/skills", ProjectDir: ".agents/skills", ConfigDirs: []string{".pi"}, Commands: []string{"pi"}},
}

// AgentIDs lists the valid --agent values.
func AgentIDs() []string {
	ids := make([]string, len(Agents))
	for i, a := range Agents {
		ids[i] = a.ID
	}
	return ids
}

// Item states, as `rex skill status` reports them.
const (
	Current    = "current"    // installed and up to date
	Outdated   = "outdated"   // installed by an older bug-trail, or edited since
	Missing    = "missing"    // not installed
	Foreign    = "foreign"    // a skill of the same name that bug-trail did not install
	Unreadable = "unreadable" // the file could not be read
)

// Changes made by setup and remove.
const (
	Created   = "created"
	Updated   = "updated"
	Unchanged = "unchanged"
	Replaced  = "replaced"
	Removed   = "removed"
	Conflict  = "conflict"
	Skipped   = "skipped"
	Failed    = "failed"
)

// Env is where the skill is installed and how agents are found. Tests replace LookPath.
type Env struct {
	Home     string
	Project  bool   // project scope instead of the user's account
	Root     string // repository root, for project scope
	LookPath func(string) (string, error)
}

// DefaultEnv returns the environment for the current user. In project scope it finds the
// repository root from the working directory.
func DefaultEnv(project bool) (Env, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Env{}, err
	}
	env := Env{Home: home, Project: project, LookPath: exec.LookPath}
	if project {
		root, err := repoRoot()
		if err != nil {
			return Env{}, err
		}
		env.Root = root
	}
	return env, nil
}

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(filepath.Join(d, ".git")); err == nil {
			return d, nil
		}
		if filepath.Dir(d) == d {
			return "", errors.New("--project needs to run inside a git repository")
		}
	}
}

// Scope is "user" or "project".
func (e Env) Scope() string {
	if e.Project {
		return "project"
	}
	return "user"
}

// Path of the skill for an agent in this scope.
func (e Env) Path(a Agent) string {
	if e.Project {
		return filepath.Join(e.Root, a.ProjectDir, Name)
	}
	return filepath.Join(e.Home, a.UserDir, Name)
}

// Detected reports whether the agent is installed on this machine.
func (e Env) Detected(a Agent) bool {
	for _, d := range a.ConfigDirs {
		if st, err := os.Stat(filepath.Join(e.Home, d)); err == nil && st.IsDir() {
			return true
		}
	}
	if e.LookPath != nil {
		for _, c := range a.Commands {
			if _, err := e.LookPath(c); err == nil {
				return true
			}
		}
	}
	return false
}

// Stub renders the SKILL.md that gets installed, from the full guide's frontmatter.
func Stub(guide []byte) []byte {
	desc := frontmatter(guide)["description"]
	return []byte(fmt.Sprintf(`---
name: %s
description: %s
---
%s Run "bug-trail skill setup" to update it and "bug-trail skill remove" to remove it. -->

# Bug Trail

Run `+"`bug-trail skill show`"+` and follow the guide it prints. It explains how to trace a GitHub issue
through the code and write the bug-trail/v2 file that the Bug Trail dashboard draws as a map, and
it always matches the installed `+"`bug-trail`"+` command.
`, Name, desc, Marker))
}

func frontmatter(doc []byte) map[string]string {
	out := map[string]string{}
	s := string(doc)
	if !strings.HasPrefix(s, "---\n") {
		return out
	}
	end := strings.Index(s[4:], "\n---")
	if end < 0 {
		return out
	}
	for _, line := range strings.Split(s[4:4+end], "\n") {
		if k, v, ok := strings.Cut(line, ":"); ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out
}

// State of the skill at dir, compared with the stub this binary would install.
func State(dir string, want []byte) string {
	b, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
	switch {
	case errors.Is(err, fs.ErrNotExist):
		if _, err := os.Stat(dir); err == nil {
			return Foreign // a directory with that name but no skill in it
		}
		return Missing
	case err != nil:
		return Unreadable
	case bytes.Equal(b, want):
		return Current
	case ours(dir, b):
		return Outdated
	default:
		return Foreign
	}
}

// ours recognises a skill bug-trail installed: the stub's marker, or a full copy written by
// the older `bug-trail install-skill` (named bug-trail, with FORMAT.md beside it).
func ours(dir string, skillMD []byte) bool {
	if bytes.Contains(skillMD, []byte(Marker)) {
		return true
	}
	if frontmatter(skillMD)["name"] != Name {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, "FORMAT.md"))
	return err == nil
}

// Item is one installed (or not) skill, for status.
type Item struct {
	Kind  string `json:"kind"`
	Path  string `json:"path"`
	State string `json:"state"`
}

// AgentReport is one agent in a status report.
type AgentReport struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Detected bool   `json:"detected"`
	Items    []Item `json:"items"`
}

// Report is the result of status.
type Report struct {
	Scope  string        `json:"scope"`
	Agents []AgentReport `json:"agents"`
}

// Status reports every known agent; nothing is changed.
func Status(env Env, guide []byte) Report {
	want := Stub(guide)
	r := Report{Scope: env.Scope()}
	for _, a := range Agents {
		p := env.Path(a)
		r.Agents = append(r.Agents, AgentReport{ID: a.ID, Name: a.Name, Detected: env.Detected(a),
			Items: []Item{{Kind: "skill", Path: p, State: State(p, want)}}})
	}
	return r
}

// Step is one change setup or remove made (or would make).
type Step struct {
	Agents []string `json:"agents"`
	Kind   string   `json:"kind"`
	Path   string   `json:"path"`
	Change string   `json:"change"`
	Note   string   `json:"note,omitempty"`
}

// Result is the outcome of setup or remove.
type Result struct {
	DryRun bool   `json:"dry_run"`
	Action string `json:"action"`
	Scope  string `json:"scope"`
	Steps  []Step `json:"steps"`
}

// Options for setup and remove.
type Options struct {
	Agents []string // agent IDs; empty means "all found" (setup) or "all known" (remove)
	DryRun bool
	Force  bool
}

func pick(ids []string, keep func(Agent) bool) ([]Agent, error) {
	for _, id := range ids {
		if !slices.Contains(AgentIDs(), id) {
			return nil, fmt.Errorf("unknown agent %q: use %s", id, strings.Join(AgentIDs(), ", "))
		}
	}
	var out []Agent
	for _, a := range Agents {
		if len(ids) > 0 && slices.Contains(ids, a.ID) || len(ids) == 0 && keep(a) {
			out = append(out, a)
		}
	}
	return out, nil
}

// targets groups agents by skill path, so a shared directory is written once.
func targets(env Env, agents []Agent) ([]string, map[string][]string) {
	var paths []string
	by := map[string][]string{}
	for _, a := range agents {
		p := env.Path(a)
		if _, ok := by[p]; !ok {
			paths = append(paths, p)
		}
		by[p] = append(by[p], a.ID)
	}
	return paths, by
}

// Setup installs the stub into the agents found (or those named). If none is found, the skill
// goes into the shared .agents/skills directory that most agents read.
func Setup(env Env, guide []byte, opt Options) (Result, error) {
	agents, err := pick(opt.Agents, env.Detected)
	if err != nil {
		return Result{}, err
	}
	res := Result{DryRun: opt.DryRun, Action: "install", Scope: env.Scope()}
	paths, by := targets(env, agents)
	if len(agents) == 0 {
		shared := Agent{ID: "shared", UserDir: ".agents/skills", ProjectDir: ".agents/skills"}
		paths, by = []string{env.Path(shared)}, map[string][]string{env.Path(shared): {}}
	}
	want := Stub(guide)
	for _, p := range paths {
		step := Step{Agents: by[p], Kind: "skill", Path: p}
		switch st := State(p, want); st {
		case Current:
			step.Change = Unchanged
		case Missing:
			step.Change = Created
		case Outdated:
			step.Change = Updated
		case Foreign, Unreadable:
			if !opt.Force {
				step.Change = Conflict
				step.Note = "a skill named bug-trail that bug-trail did not install; use --force to replace it"
				break
			}
			step.Change = Replaced
		}
		if !opt.DryRun && (step.Change == Created || step.Change == Updated || step.Change == Replaced) {
			if err := write(p, want, step.Change == Replaced || step.Change == Updated); err != nil {
				step.Change, step.Note = Failed, err.Error()
			}
		}
		res.Steps = append(res.Steps, step)
	}
	return res, nil
}

func write(dir string, stub []byte, clear bool) error {
	if clear {
		// Older copies held more files (FORMAT.md, scripts); start from an empty directory.
		if err := os.RemoveAll(dir); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "SKILL.md"), stub, 0o644)
}

// Remove takes out the skill wherever bug-trail installed it, for every known agent (or those
// named), including agents that are no longer installed. Other skills are left alone.
func Remove(env Env, guide []byte, opt Options) (Result, error) {
	agents, err := pick(opt.Agents, func(Agent) bool { return true })
	if err != nil {
		return Result{}, err
	}
	res := Result{DryRun: opt.DryRun, Action: "remove", Scope: env.Scope()}
	paths, by := targets(env, agents)
	want := Stub(guide)
	for _, p := range paths {
		step := Step{Agents: by[p], Kind: "skill", Path: p}
		switch State(p, want) {
		case Missing:
			continue // nothing to report
		case Current, Outdated:
			step.Change = Removed
			if !opt.DryRun {
				if err := os.RemoveAll(p); err != nil {
					step.Change, step.Note = Failed, err.Error()
				}
			}
		default:
			step.Change, step.Note = Skipped, "not installed by bug-trail"
		}
		res.Steps = append(res.Steps, step)
	}
	return res, nil
}

// NameOf returns an agent's display name; "shared" is the shared skills directory.
func NameOf(id string) string {
	for _, a := range Agents {
		if a.ID == id {
			return a.Name
		}
	}
	return "Shared skills directory"
}
