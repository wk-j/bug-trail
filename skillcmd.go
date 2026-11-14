package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/wk-j/bug-trail/internal/skill"
)

const skillHelp = `Set up coding agents such as Claude Code and Codex to use Bug Trail.

Bug Trail installs a skill into each agent. The skill is short: it tells the agent to run
"bug-trail skill show", which prints the full guide from this command. Upgrading bug-trail
therefore updates what agents are told, with nothing to reinstall.

Run "bug-trail skill setup" once per account, and "bug-trail skill status" to see what is installed.

Usage:
  bug-trail skill [command] [flags]

Commands:
  status  Report whether the skill is installed in each agent
  setup   Install the skill into agents
  remove  Remove the skill from agents
  show    Print the guide that the skill gives agents

Run "bug-trail skill COMMAND --help" for a command's options.
`

var skillVerbHelp = map[string]string{
	"status": `Report, for each agent Bug Trail knows, whether the agent was found on this machine and whether
the skill is installed in it. Nothing is changed.

Each item is reported as one of:

  current      installed and up to date
  outdated     installed by an older bug-trail, or edited since
  missing      not installed
  foreign      a skill of the same name that bug-trail did not install
  unreadable   the file could not be read

Usage:
  bug-trail skill status [flags]

Options:
      --project  report on the current repository instead of your account
      --json     print the report as JSON
`,
	"setup": `Install the skill into the agents found on this machine, or into the agents named with --agent.
If no agent is found, the skill goes into the shared ~/.agents/skills directory that most agents read.

Claude Code reads ~/.claude/skills. Codex, OpenCode and Pi share ~/.agents/skills, which is
written once. Run this once per account; running it again is safe and updates anything an older
bug-trail installed.

If a skill named bug-trail is already installed and bug-trail did not install it, it is left alone
and reported as a conflict. Use --force to replace it.

Usage:
  bug-trail skill setup [flags]

Options:
      --agent AGENT  use only AGENT, which is claude, codex, opencode or pi (repeatable)
      --project      set up the current repository instead of your account
      --dry-run      report what would change without changing anything
      --force        replace a skill named bug-trail that bug-trail did not install
      --json         print the result as JSON
`,
	"remove": `Remove the skill from every agent Bug Trail knows, or from the agents named with --agent. Agents
that are no longer installed are included, so nothing bug-trail installed is left behind.

Only skills that bug-trail installed are removed, including full copies written by the older
"bug-trail install-skill". Other skills are left as they were.

Usage:
  bug-trail skill remove [flags]

Options:
      --agent AGENT  use only AGENT, which is claude, codex, opencode or pi (repeatable)
      --project      remove from the current repository instead of your account
      --dry-run      report what would change without changing anything
      --json         print the result as JSON
`,
	"show": `Print the guide that the skill gives agents: how to trace a GitHub issue through the code, and
the bug-trail/v2 format.

An agent with the skill installed reads the guide through the skill. An agent without it can run
this command to read the same guide.

Usage:
  bug-trail skill show
`,
}

// agentList is a repeatable --agent flag.
type agentList []string

func (a *agentList) String() string     { return strings.Join(*a, ",") }
func (a *agentList) Set(v string) error { *a = append(*a, v); return nil }

func skillGuide() ([]byte, error) { return skillFiles.ReadFile("skill/bug-trail/SKILL.md") }

func cmdSkill(args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(skillHelp)
		return nil
	}
	verb, rest := args[0], args[1:]
	help, ok := skillVerbHelp[verb]
	if !ok {
		fmt.Fprint(os.Stderr, skillHelp)
		return fmt.Errorf("unknown command %q for \"bug-trail skill\"", verb)
	}

	fl := flag.NewFlagSet("skill "+verb, flag.ContinueOnError)
	fl.SetOutput(io.Discard)
	var agents agentList
	project := fl.Bool("project", false, "")
	asJSON := fl.Bool("json", false, "")
	dryRun := fl.Bool("dry-run", false, "")
	force := fl.Bool("force", false, "")
	if verb == "setup" || verb == "remove" {
		fl.Var(&agents, "agent", "")
	}
	if err := fl.Parse(rest); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			fmt.Print(help)
			return nil
		}
		fmt.Fprint(os.Stderr, help)
		return err
	}
	allowed := map[string][]string{"status": {"project", "json"}, "setup": {"agent", "project", "dry-run", "force", "json"},
		"remove": {"agent", "project", "dry-run", "json"}, "show": {}}[verb]
	var bad error
	fl.Visit(func(f *flag.Flag) {
		ok := false
		for _, a := range allowed {
			ok = ok || a == f.Name
		}
		if !ok && bad == nil {
			bad = fmt.Errorf("unknown flag --%s for \"bug-trail skill %s\"", f.Name, verb)
		}
	})
	if bad != nil {
		return bad
	}
	if fl.NArg() > 0 {
		return fmt.Errorf("\"bug-trail skill %s\" takes no arguments", verb)
	}

	guide, err := skillGuide()
	if err != nil {
		return err
	}
	if verb == "show" {
		return printGuide()
	}
	env, err := skill.DefaultEnv(*project)
	if err != nil {
		return err
	}

	switch verb {
	case "status":
		rep := skill.Status(env, guide)
		if *asJSON {
			return printJSON(rep)
		}
		printStatus(env, rep)
		return nil
	default:
		opt := skill.Options{Agents: agents, DryRun: *dryRun, Force: *force}
		run := skill.Setup
		if verb == "remove" {
			run = skill.Remove
		}
		res, err := run(env, guide, opt)
		if err != nil {
			return err
		}
		if *asJSON {
			if err := printJSON(res); err != nil {
				return err
			}
		} else {
			printResult(env, res)
		}
		for _, s := range res.Steps {
			if s.Change == skill.Failed || s.Change == skill.Conflict {
				return errors.New("some agents were not changed; see above")
			}
		}
		return nil
	}
}

func printGuide() error {
	for i, name := range []string{"SKILL.md", "FORMAT.md"} {
		b, err := skillFiles.ReadFile("skill/bug-trail/" + name)
		if err != nil {
			return err
		}
		s := string(b)
		if i == 0 && strings.HasPrefix(s, "---\n") { // the frontmatter is for skill loaders, not readers
			if end := strings.Index(s[4:], "\n---\n"); end >= 0 {
				s = strings.TrimLeft(s[4+end+5:], "\n")
			}
		}
		fmt.Print(strings.TrimRight(s, "\n") + "\n\n")
	}
	return nil
}

func printJSON(v any) error {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(v)
}

// tilde shortens paths under the home directory, as rex does.
func tilde(env skill.Env, p string) string {
	if rest, ok := strings.CutPrefix(p, env.Home); ok && env.Home != "" {
		return "~" + rest
	}
	return p
}

func printStatus(env skill.Env, rep skill.Report) {
	needs := false
	for i, a := range rep.Agents {
		if i > 0 {
			fmt.Println()
		}
		found := "not found"
		if a.Detected {
			found = "found"
		}
		fmt.Printf("%s (%s)\n", a.Name, found)
		for _, it := range a.Items {
			fmt.Printf("  %-6s %-12s %s\n", it.Kind, it.State, tilde(env, it.Path))
			if a.Detected && (it.State == skill.Missing || it.State == skill.Outdated) {
				needs = true
			}
		}
	}
	if needs {
		fmt.Println("\nRun \"bug-trail skill setup\" to install or update the skill.")
	}
}

func printResult(env skill.Env, res skill.Result) {
	if res.DryRun {
		fmt.Println("Dry run: nothing was changed. This is what would happen.")
	}
	if len(res.Steps) == 0 {
		if res.DryRun {
			fmt.Println()
		}
		fmt.Println("Nothing to remove: the bug-trail skill isn't installed here.")
		return
	}
	for i, s := range res.Steps {
		if i > 0 || res.DryRun {
			fmt.Println()
		}
		names := make([]string, len(s.Agents))
		for j, id := range s.Agents {
			names[j] = skill.NameOf(id)
		}
		label := strings.Join(names, ", ")
		if label == "" {
			label = "No agent found: shared skills directory"
		}
		fmt.Println(label)
		fmt.Printf("  %-6s %-12s %s\n", s.Kind, s.Change, tilde(env, s.Path))
		if s.Note != "" {
			fmt.Printf("  %-6s %-12s %s\n", "", "", s.Note)
		}
	}
}
