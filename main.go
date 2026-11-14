// Command bug-trail maps a GitHub bug from report to fix.
//
// An agent follows the embedded skill to write a bug-trail/v1 JSON file; the
// dashboard watches the trails folder and draws each file as a map.
package main

import (
	"context"
	"embed"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

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
  bug-trail serve [--dir DIR] [--port 4317] [--open]
      Start the dashboard. It watches DIR and redraws when an agent writes a trail.
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
	port := fl.Int("port", 4317, "port to listen on")
	open := fl.Bool("open", false, "open the dashboard in a browser")
	_ = fl.Parse(args)

	abs, err := filepath.Abs(*dir)
	if err != nil {
		return err
	}
	web, _ := fs.Sub(webFiles, "web")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	url := fmt.Sprintf("http://localhost:%d", *port)
	s := &server.Server{Dir: abs, Web: web}
	err = s.ListenAndServe(ctx, fmt.Sprintf("127.0.0.1:%d", *port), func() {
		fmt.Printf("Bug Trail dashboard: %s\nWatching: %s\n", url, abs)
		if *open {
			openBrowser(url)
		}
	})
	if errors.Is(err, syscall.EADDRINUSE) {
		return fmt.Errorf("port %d is in use; try --port %d", *port, *port+1)
	}
	return err
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
