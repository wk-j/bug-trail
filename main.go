// Command bug-trail maps a GitHub bug from report to fix.
//
// An agent follows the embedded skill to write a bug-trail/v1 JSON file; the
// dashboard watches the trails folder and draws each file as a map.
package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/wk-j/bug-trail/internal/format"
	"github.com/wk-j/bug-trail/internal/server"
)

//go:embed web
var webFiles embed.FS

//go:embed all:skill/bug-trail
var skillFiles embed.FS

var version = "0.2.0"

func defaultDir() string {
	if d := os.Getenv("BUG_TRAIL_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".bug-trail", "trails")
}

func usage(w io.Writer) {
	fmt.Fprintf(w, `bug-trail %s — map a GitHub bug from report to fix

Usage:
  bug-trail serve [--dir DIR] [--host 127.0.0.1] [--port 4317] [--open]
      Start the dashboard. It watches DIR and redraws when an agent writes a trail.
      With BUG_TRAIL_TOKEN set, it also accepts uploads from `+"`bug-trail push`"+`.
  bug-trail push [--server URL] [--token T] <file.json> [...]
      Validate trail files and upload them to a Bug Trail server
      (defaults: BUG_TRAIL_SERVER, BUG_TRAIL_TOKEN).
  bug-trail healthcheck [URL]
      Exit 0 if the server is healthy (used by Docker).
  bug-trail install-skill [--project PATH | --to DIR]
      Copy the bug-trail skill so agents can use it.
        (default)        ~/.claude/skills/bug-trail
        --project PATH   PATH/.claude/skills/bug-trail
        --to DIR         DIR/bug-trail (for other agents' skill folders)
  bug-trail skill
      Print the skill instructions and the format (for agents without skill support).
  bug-trail prompt <issue-url>
      Print a prompt you can give any agent to analyze that issue.
  bug-trail validate <file.json> [...]
      Check trail files against the bug-trail/v1 format.
  bug-trail version

Trails folder: %s
  (set BUG_TRAIL_DIR to change it; agents read the same variable)
`, version, defaultDir())
}

func main() {
	if len(os.Args) < 2 {
		usage(os.Stdout)
		return
	}
	cmd, args := os.Args[1], os.Args[2:]
	var err error
	switch cmd {
	case "serve":
		err = cmdServe(args)
	case "install-skill":
		err = cmdInstallSkill(args)
	case "skill":
		err = cmdSkill()
	case "prompt":
		err = cmdPrompt(args)
	case "validate":
		os.Exit(cmdValidate(args))
	case "push":
		err = cmdPush(args)
	case "healthcheck":
		os.Exit(cmdHealthcheck(args))
	case "version", "--version", "-v":
		fmt.Println(version)
	case "help", "--help", "-h":
		usage(os.Stdout)
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", cmd)
		usage(os.Stderr)
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func cmdServe(args []string) error {
	fl := flag.NewFlagSet("serve", flag.ExitOnError)
	dir := fl.String("dir", defaultDir(), "folder of trail files to watch")
	host := fl.String("host", envOr("BUG_TRAIL_HOST", "127.0.0.1"), "address to listen on (0.0.0.0 to accept remote connections)")
	port := fl.Int("port", envInt("PORT", 4317), "port to listen on")
	open := fl.Bool("open", false, "open the dashboard in a browser")
	_ = fl.Parse(args)

	abs, err := filepath.Abs(*dir)
	if err != nil {
		return err
	}
	web, _ := fs.Sub(webFiles, "web")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	token := os.Getenv("BUG_TRAIL_TOKEN")
	url := fmt.Sprintf("http://localhost:%d", *port)
	s := &server.Server{Dir: abs, Web: web, Token: token}
	err = s.ListenAndServe(ctx, net.JoinHostPort(*host, strconv.Itoa(*port)), func() {
		fmt.Printf("Bug Trail dashboard: %s (listening on %s)\nWatching: %s\n", url, net.JoinHostPort(*host, strconv.Itoa(*port)), abs)
		if token != "" {
			fmt.Println("Uploads: enabled (PUT /api/trails/{id} with the bearer token)")
		} else {
			fmt.Println("Uploads: disabled (set BUG_TRAIL_TOKEN to let `bug-trail push` upload trails)")
		}
		if *open {
			openBrowser(url)
		}
	})
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("port %d is in use; try --port %d", *port, *port+1)
	}
	return err
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return n
	}
	return def
}

// cmdPush validates trail files locally, then uploads them to a Bug Trail server.
func cmdPush(args []string) error {
	fl := flag.NewFlagSet("push", flag.ExitOnError)
	srv := fl.String("server", os.Getenv("BUG_TRAIL_SERVER"), "server URL, e.g. https://bugs.example.com (or BUG_TRAIL_SERVER)")
	token := fl.String("token", "", "upload token (default: BUG_TRAIL_TOKEN)")
	_ = fl.Parse(args)
	if *token == "" {
		*token = os.Getenv("BUG_TRAIL_TOKEN")
	}
	files := fl.Args()
	switch {
	case len(files) == 0:
		return errors.New("usage: bug-trail push [--server URL] [--token T] <file.json> [...]")
	case *srv == "":
		return errors.New("no server: pass --server or set BUG_TRAIL_SERVER")
	case *token == "":
		return errors.New("no token: pass --token or set BUG_TRAIL_TOKEN")
	}
	base := strings.TrimRight(*srv, "/")
	client := &http.Client{Timeout: 30 * time.Second}
	failed := false
	for _, file := range files {
		id := strings.TrimSuffix(filepath.Base(file), ".json")
		raw, err := os.ReadFile(file)
		if err == nil {
			if _, res := format.ValidateJSON(raw); len(res.Errors) > 0 {
				err = fmt.Errorf("%d format errors; run `bug-trail validate %s`", len(res.Errors), file)
			}
		}
		if err == nil {
			err = putTrail(client, base, *token, id, raw)
		}
		if err != nil {
			fmt.Printf("✗ %s: %v\n", file, err)
			failed = true
			continue
		}
		fmt.Printf("✓ %s → %s/#/t/%s\n", file, base, id)
	}
	if failed {
		return errors.New("some files were not uploaded")
	}
	return nil
}

func putTrail(client *http.Client, base, token, id string, raw []byte) error {
	req, err := http.NewRequest(http.MethodPut, base+"/api/trails/"+id, bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode/100 == 2 {
		return nil
	}
	var body struct {
		Error string `json:"error"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	if body.Error == "" {
		body.Error = res.Status
	}
	return fmt.Errorf("server said %d: %s", res.StatusCode, body.Error)
}

// cmdHealthcheck exits 0 when the server answers /healthz. Used by the
// container healthcheck, since the runtime image has no shell or curl.
func cmdHealthcheck(args []string) int {
	url := fmt.Sprintf("http://127.0.0.1:%d/healthz", envInt("PORT", 4317))
	if len(args) > 0 {
		url = args[0]
	}
	res, err := (&http.Client{Timeout: 3 * time.Second}).Get(url)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		fmt.Fprintln(os.Stderr, res.Status)
		return 1
	}
	return 0
}

func openBrowser(url string) {
	var c *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		c = exec.Command("open", url)
	case "windows":
		c = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		c = exec.Command("xdg-open", url)
	}
	_ = c.Start()
}

func cmdInstallSkill(args []string) error {
	fl := flag.NewFlagSet("install-skill", flag.ExitOnError)
	project := fl.String("project", "", "install into PATH/.claude/skills/bug-trail")
	to := fl.String("to", "", "install into DIR/bug-trail")
	fl.Bool("global", true, "install into ~/.claude/skills/bug-trail (default)")
	_ = fl.Parse(args)

	var dest string
	switch {
	case *to != "":
		dest = filepath.Join(*to, "bug-trail")
	case *project != "":
		dest = filepath.Join(*project, ".claude", "skills", "bug-trail")
	default:
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		dest = filepath.Join(home, ".claude", "skills", "bug-trail")
	}
	dest, _ = filepath.Abs(dest)

	src, _ := fs.Sub(skillFiles, "skill/bug-trail")
	// Clear the old copy so files removed from the skill do not linger.
	if err := os.RemoveAll(dest); err != nil {
		return err
	}
	if err := os.CopyFS(dest, src); err != nil {
		return err
	}
	fmt.Printf("Installed the bug-trail skill to %s\n", dest)
	fmt.Printf("Agents without skill support can run `bug-trail skill` or read %s.\n", filepath.Join(dest, "SKILL.md"))
	return nil
}

func cmdSkill() error {
	for _, name := range []string{"SKILL.md", "FORMAT.md"} {
		b, err := skillFiles.ReadFile("skill/bug-trail/" + name)
		if err != nil {
			return err
		}
		fmt.Printf("%s\n\n", b)
	}
	return nil
}

func cmdPrompt(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: bug-trail prompt <issue-url>")
	}
	fmt.Printf(`Analyze the GitHub issue %s and write a bug trail.
Use the "bug-trail" skill if you have it; otherwise run `+"`bug-trail skill`"+` and follow the instructions it prints.
Write the result to %s and run `+"`bug-trail validate`"+` on it before you finish.
`, args[0], defaultDir())
	return nil
}

func cmdValidate(files []string) int {
	if len(files) == 0 {
		fmt.Fprintln(os.Stderr, "usage: bug-trail validate <file.json> [...]")
		return 2
	}
	failed := false
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			fmt.Printf("✗ %s\n  error: cannot read file: %v\n", file, err)
			failed = true
			continue
		}
		t, res := format.ValidateJSON(raw)
		nodes, edges := 0, 0
		if m, ok := t.(map[string]any); ok {
			if n, ok := m["nodes"].([]any); ok {
				nodes = len(n)
			}
			if e, ok := m["edges"].([]any); ok {
				edges = len(e)
			}
		}
		mark := "✓"
		if len(res.Errors) > 0 {
			mark, failed = "✗", true
		}
		fmt.Printf("%s %s  (%d nodes, %d edges)\n", mark, file, nodes, edges)
		for _, m := range res.Errors {
			fmt.Println("  error:", m)
		}
		for _, m := range res.Warnings {
			fmt.Println("  warn: ", m)
		}
	}
	if failed {
		return 1
	}
	return 0
}
