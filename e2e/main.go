// Command e2e runs bug-trail's end-to-end cases: it builds the real binary,
// starts `bug-trail serve`, drives the CLI (`push`, `validate`, `config`,
// `skill show`) and checks the dashboard and API over HTTP. It implements the
// Krypton E2E Adapter Contract v1, so .krypton/e2e/project.toml points straight
// at it, `valence push` can publish its runs, and it runs by hand too:
//
//	go run ./e2e list
//	go run ./e2e run <caseId> [--param k=v]…
//	go run ./e2e history
//
// See e2e/README.md.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Case is one entry of `list`; Run executes it.
type Case struct {
	ID     string            `json:"id"`
	Title  string            `json:"title"`
	Code   string            `json:"code,omitempty"`
	Issue  int               `json:"issue,omitempty"`
	Params map[string]string `json:"params,omitempty"`
	Files  []string          `json:"files,omitempty"`
	Map    string            `json:"map,omitempty"`
	Run    func(*Run)        `json:"-"`
}

// cases lists every case; add a new one here (see "Adding a case" in README.md).
var cases = []Case{serveAndPush, cliCommands}

const usage = "usage: go run ./e2e list | run <caseId> [--param k=v]… | history"

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	root, err := repoRoot()
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(2)
	}
	switch os.Args[1] {
	case "list":
		err = printJSON(map[string]any{"version": 1, "cases": cases})
	case "history":
		err = history(root)
	case "run":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, usage)
			os.Exit(2)
		}
		var verdict string
		verdict, err = run(root, os.Args[2], os.Args[3:])
		if err == nil && verdict != "PASS" {
			os.Exit(1) // informational for Krypton; handy by hand and in CI
		}
	default:
		fmt.Fprintln(os.Stderr, usage)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "e2e:", err)
		os.Exit(1)
	}
}

// repoRoot is the working directory, which must be this repository's root.
func repoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(wd, "go.mod"))
	if err != nil || !strings.Contains(string(data), "module github.com/wk-j/bug-trail") {
		return "", fmt.Errorf("run from the bug-trail repository root (no bug-trail go.mod in %s)", wd)
	}
	return wd, nil
}

func printJSON(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = fmt.Println(string(data))
	return err
}

func run(root, caseID string, args []string) (string, error) {
	var c *Case
	for i := range cases {
		if cases[i].ID == caseID {
			c = &cases[i]
		}
	}
	if c == nil {
		return "", fmt.Errorf("%w %q; `go run ./e2e list` shows the cases", errUnknownCase, caseID)
	}
	params := map[string]string{}
	for k, v := range c.Params {
		params[k] = v
	}
	for i := 0; i < len(args); i++ {
		if args[i] != "--param" || i+1 == len(args) {
			return "", fmt.Errorf("unexpected argument %q; %s", args[i], usage)
		}
		k, v, ok := strings.Cut(args[i+1], "=")
		if !ok {
			return "", fmt.Errorf("--param %q is not key=value", args[i+1])
		}
		params[k] = v
		i++
	}

	started := time.Now().UTC()
	runID := strings.Replace(started.Format("20060102T150405.000"), ".", "", 1) + "Z"
	rel := filepath.Join("e2e", "runs", caseID, runID)
	r := &Run{Root: root, Dir: filepath.Join(root, rel), RelDir: rel, Params: params}
	if err := os.MkdirAll(r.Dir, 0o755); err != nil {
		return "", err
	}
	r.Result = Result{Version: 1, CaseID: caseID, RunID: runID, StartedAt: started.Format(time.RFC3339Nano), Env: "local", Versions: versions(root)}
	if len(params) > 0 {
		r.Result.Params = params
	}
	fmt.Printf("run %s %s\n", caseID, runID)

	func() {
		defer func() {
			if p := recover(); p != nil {
				r.Broken("case panicked: %v", p)
			}
		}()
		c.Run(r)
	}()
	// The binary is rebuilt every run; it is not evidence.
	_ = os.RemoveAll(filepath.Join(r.Dir, "bin"))

	r.Result.FinishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	r.Result.Verdict, r.Result.Message = r.verdict()
	if r.Result.Checks == nil {
		r.Result.Checks = []Check{}
	}
	if err := writeJSON(filepath.Join(r.Dir, "result.json"), r.Result); err != nil {
		return "", err
	}
	if out := os.Getenv("KRYPTON_E2E_RESULT"); out != "" {
		if err := writeJSON(out, r.Result); err != nil {
			return "", err
		}
	}
	fmt.Printf("%s %s %s\n%s\n", r.Result.Verdict, caseID, runID, filepath.Join(rel, "result.json"))
	return r.Result.Verdict, nil
}

// versions names what was under test: the Go toolchain and the bug-trail commit.
func versions(root string) map[string]string {
	v := map[string]string{}
	if out, err := exec.Command("go", "env", "GOVERSION").Output(); err == nil {
		v["go"] = strings.TrimSpace(string(out))
	}
	if out, err := runCmd(root, nil, "git", "rev-parse", "--short", "HEAD"); err == nil {
		rev := strings.TrimSpace(string(out))
		if st, err := runCmd(root, nil, "git", "status", "--porcelain"); err == nil && len(strings.TrimSpace(string(st))) > 0 {
			rev += "-dirty"
		}
		v["bug-trail"] = rev
	}
	return v
}

// history prints the Result of every run kept under e2e/runs/, newest first.
// It only reads files, so `valence check` and `valence push` may call it.
func history(root string) error {
	paths, _ := filepath.Glob(filepath.Join(root, "e2e", "runs", "*", "*", "result.json"))
	type item struct {
		started string
		raw     json.RawMessage
	}
	var items []item
	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err != nil {
			fmt.Fprintf(os.Stderr, "history: skip %s: %v\n", p, err)
			continue
		}
		var head struct {
			StartedAt string `json:"startedAt"`
		}
		if json.Unmarshal(data, &head) != nil {
			fmt.Fprintf(os.Stderr, "history: skip %s: not JSON\n", p)
			continue
		}
		items = append(items, item{head.StartedAt, json.RawMessage(data)})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].started > items[j].started })
	runs := make([]json.RawMessage, 0, len(items))
	for _, it := range items {
		runs = append(runs, it.raw)
	}
	return printJSON(map[string]any{"version": 1, "runs": runs})
}

var errUnknownCase = errors.New("unknown case")
