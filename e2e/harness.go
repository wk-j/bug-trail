package main

import (
	"bufio"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Result is a Krypton e2e Result v1.
type Result struct {
	Version    int               `json:"version"`
	CaseID     string            `json:"caseId"`
	RunID      string            `json:"runId"`
	Verdict    string            `json:"verdict"`
	StartedAt  string            `json:"startedAt"`
	FinishedAt string            `json:"finishedAt"`
	Env        string            `json:"env,omitempty"`
	Versions   map[string]string `json:"versions,omitempty"`
	Params     map[string]string `json:"params,omitempty"`
	Checks     []Check           `json:"checks"`
	Artifacts  []Artifact        `json:"artifacts,omitempty"`
	Message    string            `json:"message,omitempty"`
}

type Check struct {
	Group  string `json:"group,omitempty"`
	Label  string `json:"label"`
	Status string `json:"status"`
	Detail string `json:"detail,omitempty"`
	At     string `json:"at,omitempty"` // node of the case's map the check proves
}

type Artifact struct {
	Label string `json:"label"`
	Path  string `json:"path"`
}

// Run is one execution of a case. Evidence goes to Dir
// (e2e/runs/<caseId>/<runId>/), which every artifact path points into.
type Run struct {
	Root   string // repository root
	Dir    string // absolute run folder
	RelDir string // run folder relative to Root
	Params map[string]string
	Result Result
	broken string // the harness itself failed: ERROR
	saved  int
}

func (r *Run) add(at, group, label, status, detail string) {
	r.Result.Checks = append(r.Result.Checks, Check{Group: group, Label: label, Status: status, Detail: detail, At: at})
	mark := map[string]string{"pass": "PASS", "fail": "FAIL", "blocked": "BLOCKED", "info": "INFO"}[status]
	if detail != "" {
		detail = " — " + strings.ReplaceAll(detail, "\n", "\n          ")
	}
	fmt.Printf("%-8s[%s] %s%s\n", mark, group, label, detail)
}

// Check records one expected result and reports whether it held. at is the
// node of the case's map the check proves, or where it found the failure.
func (r *Run) Check(at, group, label string, ok bool, detail string) bool {
	status := "fail"
	if ok {
		status = "pass"
	}
	r.add(at, group, label, status, detail)
	return ok
}

func (r *Run) Info(group, label, detail string) { r.add("", group, label, "info", detail) }

// Block records a failed precondition: the verdict is BLOCKED, not FAIL.
func (r *Run) Block(group, label, detail string) { r.add("", group, label, "blocked", detail) }

// Broken records a harness failure: the verdict is ERROR.
func (r *Run) Broken(format string, args ...any) {
	r.broken = fmt.Sprintf(format, args...)
	fmt.Printf("ERROR   %s\n", r.broken)
}

// Save writes evidence into the run folder and lists it as an artifact.
func (r *Run) Save(label, name string, data []byte) {
	p := filepath.Join(r.Dir, name)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		r.Broken("save %s: %v", name, err)
		return
	}
	if err := os.WriteFile(p, data, 0o644); err != nil {
		r.Broken("save %s: %v", name, err)
		return
	}
	r.Artifact(label, name)
}

// SaveResponse keeps an HTTP body as numbered evidence.
func (r *Run) SaveResponse(name string, body string) {
	r.saved++
	r.Save("response "+name, fmt.Sprintf("responses/%02d-%s", r.saved, name), []byte(body))
}

// Artifact lists a file or folder inside the run folder.
func (r *Run) Artifact(label, name string) {
	r.Result.Artifacts = append(r.Result.Artifacts, Artifact{Label: label, Path: filepath.ToSlash(filepath.Join(r.RelDir, name))})
}

func (r *Run) verdict() (string, string) {
	var failed []string
	for _, c := range r.Result.Checks {
		switch c.Status {
		case "blocked":
			return "BLOCKED", "blocked: " + c.Label + " — " + c.Detail
		case "fail":
			failed = append(failed, c.Label)
		}
	}
	switch {
	case r.broken != "":
		return "ERROR", r.broken
	case len(failed) > 0:
		return "FAIL", fmt.Sprintf("%d check(s) failed: %s", len(failed), strings.Join(failed, "; "))
	}
	return "PASS", ""
}

// --- the app under test ---------------------------------------------------

// buildBugTrail builds the working tree into the run folder.
func (r *Run) buildBugTrail() (string, bool) {
	if _, err := exec.LookPath("go"); err != nil {
		r.Block("build", "go is on PATH", err.Error())
		return "", false
	}
	bin := filepath.Join(r.Dir, "bin", "bug-trail")
	out, err := runCmd(r.Root, nil, "go", "build", "-o", bin, ".")
	r.Save("go build log", "build.log", out)
	if !r.Check("", "build", "bug-trail builds from the working tree", err == nil, errDetail(err, out)) {
		return "", false
	}
	return bin, true
}

// isolatedEnv runs the binary with its own config file and no BUG_TRAIL_*
// settings from the caller, so the user's config never leaks into a run.
func (r *Run) isolatedEnv(extra ...string) []string {
	var env []string
	for _, kv := range os.Environ() {
		if !strings.HasPrefix(kv, "BUG_TRAIL_") && !strings.HasPrefix(kv, "PORT=") {
			env = append(env, kv)
		}
	}
	env = append(env, "BUG_TRAIL_CONFIG="+filepath.Join(r.Dir, "home", "config.json"))
	return append(env, extra...)
}

type server struct {
	cmd     *exec.Cmd
	URL     string
	exited  chan struct{}
	waitErr error
}

// startServer runs `bug-trail serve` on a free loopback port and waits up to
// 10 s for GET /healthz to answer 200.
func (r *Run) startServer(bin, dir, token, logName, at string) (*server, bool) {
	port, err := freePort()
	if err != nil {
		r.Broken("no free port: %v", err)
		return nil, false
	}
	logFile, err := os.Create(filepath.Join(r.Dir, logName))
	if err != nil {
		r.Broken("server log: %v", err)
		return nil, false
	}
	r.Artifact("server log ("+logName+")", logName)
	cmd := exec.Command(bin, "serve", "--dir", dir, "--host", "127.0.0.1", "--port", strconv.Itoa(port))
	cmd.Env = r.isolatedEnv("BUG_TRAIL_TOKEN=" + token)
	cmd.Stdout, cmd.Stderr = logFile, logFile
	if err := cmd.Start(); err != nil {
		logFile.Close()
		r.Check(at, "serve", "bug-trail serve starts", false, err.Error())
		return nil, false
	}
	s := &server{cmd: cmd, URL: fmt.Sprintf("http://127.0.0.1:%d", port), exited: make(chan struct{})}
	go func() { s.waitErr = cmd.Wait(); logFile.Close(); close(s.exited) }()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case <-s.exited:
			r.Check(at, "serve", "bug-trail serve answers GET /healthz with 200", false, fmt.Sprintf("exited before answering: %v (see %s)", s.waitErr, logName))
			return nil, false
		default:
		}
		if resp, err := get(s.URL + "/healthz"); err == nil && resp.Status == http.StatusOK {
			r.Check(at, "serve", "bug-trail serve answers GET /healthz with 200", true, s.URL)
			return s, true
		}
		time.Sleep(100 * time.Millisecond)
	}
	s.stop()
	r.Check(at, "serve", "bug-trail serve answers GET /healthz with 200", false, "no 200 within 10 s on "+s.URL)
	return nil, false
}

// stop interrupts the server and kills it after 5 s.
func (s *server) stop() {
	if s == nil {
		return
	}
	select {
	case <-s.exited:
		return
	default:
	}
	_ = s.cmd.Process.Signal(os.Interrupt)
	select {
	case <-s.exited:
	case <-time.After(5 * time.Second):
		_ = s.cmd.Process.Kill()
		<-s.exited
	}
}

// cli runs the binary with args in the repo root and keeps its output.
func (r *Run) cli(bin, logName string, env []string, args ...string) (string, int) {
	cmd := exec.Command(bin, args...)
	cmd.Dir = r.Root
	cmd.Env = env
	out, err := cmd.CombinedOutput()
	code := 0
	if ee, ok := err.(*exec.ExitError); ok {
		code = ee.ExitCode()
	} else if err != nil {
		code = -1
		out = append(out, []byte("\n"+err.Error())...)
	}
	r.Save("bug-trail "+args[0]+" ("+logName+")", logName, append([]byte("$ bug-trail "+strings.Join(args, " ")+"\n"), out...))
	return string(out), code
}

type response struct {
	Status int
	Header http.Header
	Body   string
}

func do(method, url, token, body string) (response, error) {
	req, err := http.NewRequest(method, url, strings.NewReader(body))
	if err != nil {
		return response{}, err
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	client := http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return response{}, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	return response{Status: resp.StatusCode, Header: resp.Header, Body: string(b)}, err
}

func get(url string) (response, error) { return do(http.MethodGet, url, "", "") }

// events subscribes to /events and sends every `data:` payload on the channel
// until the stream closes.
func events(url string) (<-chan string, func(), error) {
	resp, err := http.Get(url + "/events")
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan string, 32)
	go func() {
		defer close(ch)
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			if d, ok := strings.CutPrefix(sc.Text(), "data: "); ok {
				ch <- d
			}
		}
	}()
	return ch, func() { resp.Body.Close() }, nil
}

// waitEvent waits up to d for an event whose payload names id.
func waitEvent(ch <-chan string, id string, d time.Duration) (bool, string) {
	timeout := time.After(d)
	var seen []string
	for {
		select {
		case e, ok := <-ch:
			if !ok {
				return false, "stream closed; saw " + strings.Join(seen, ", ")
			}
			seen = append(seen, e)
			var m struct{ ID string }
			if json.Unmarshal([]byte(e), &m) == nil && m.ID == id {
				return true, e
			}
		case <-timeout:
			return false, fmt.Sprintf("no event for %q within %s; saw [%s]", id, d, strings.Join(seen, ", "))
		}
	}
}

// --- helpers --------------------------------------------------------------

func runCmd(dir string, env []string, name string, args ...string) ([]byte, error) {
	cmd := exec.Command(name, args...)
	cmd.Dir = dir
	if env != nil {
		cmd.Env = env
	}
	return cmd.CombinedOutput()
}

func errDetail(err error, out []byte) string {
	if err == nil {
		return ""
	}
	tail := strings.TrimSpace(string(out))
	if lines := strings.Split(tail, "\n"); len(lines) > 15 {
		tail = strings.Join(lines[len(lines)-15:], "\n")
	}
	return strings.TrimSpace(err.Error() + "\n" + tail)
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func randomToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o644)
}

func short(s string) string {
	s = strings.TrimSpace(s)
	if len(s) > 300 {
		return s[:300] + "…"
	}
	return s
}
