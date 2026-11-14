package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/wk-j/bug-trail/internal/config"
)

const configHelp = `Store bug-trail settings in a config file, so you don't have to export environment variables.

A setting is taken from, in order: a command-line flag, its environment variable, the config
file, then the default. Environment variables still win over the file, so a container or a
one-off shell can override it.

Usage:
  bug-trail config list              show every setting, its value and where it comes from
  bug-trail config get KEY           print a setting's value (empty if unset)
  bug-trail config set KEY [VALUE]   store a setting; for token, leave VALUE out to type it unseen
  bug-trail config unset KEY         remove a setting from the file
  bug-trail config path              print where the config file is

Keys:
  server   Bug Trail server that "bug-trail push" uploads to          (env BUG_TRAIL_SERVER)
  token    upload token for the server                                (env BUG_TRAIL_TOKEN)
  dir      folder where trail files are written and served from       (env BUG_TRAIL_DIR)

The file is created readable only by you, because it can hold the token.
`

func cmdConfig(args []string) error {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(configHelp)
		return nil
	}
	verb, rest := args[0], args[1:]
	switch verb {
	case "path":
		p, err := config.Path()
		if err != nil {
			return err
		}
		fmt.Println(p)
		return nil

	case "list", "ls":
		p, _ := config.Path()
		fmt.Printf("Config file: %s\n\n", p)
		for _, k := range config.Keys {
			fallback := ""
			if k.Name == "dir" {
				fallback = builtinDir()
			}
			v, err := config.Resolve(k.Name, "", fallback)
			if err != nil {
				return err
			}
			shown, from := v.Value, v.Source
			if shown == "" {
				shown, from = "(not set)", ""
			} else if k.Secret {
				shown = config.Mask(shown)
			}
			if from != "" {
				from = "(" + from + ")"
			}
			fmt.Printf("  %-7s %-44s %s\n", k.Name, shown, from)
		}
		return nil

	case "get":
		if len(rest) != 1 {
			return errors.New("usage: bug-trail config get KEY")
		}
		fallback := ""
		if rest[0] == "dir" {
			fallback = builtinDir()
		}
		v, err := config.Resolve(rest[0], "", fallback)
		if err != nil {
			return err
		}
		if v.Value != "" {
			fmt.Println(v.Value)
		}
		return nil

	case "set":
		if len(rest) < 1 || len(rest) > 2 {
			return errors.New("usage: bug-trail config set KEY [VALUE]")
		}
		key, err := config.Lookup(rest[0])
		if err != nil {
			return err
		}
		var value string
		if len(rest) == 2 {
			value = rest[1]
			if key.Secret {
				fmt.Fprintln(os.Stderr, "Note: a token typed on the command line stays in your shell history. Next time, run \"bug-trail config set token\" and type it at the prompt.")
			}
		} else {
			if value, err = readValue(key); err != nil {
				return err
			}
		}
		stored, err := config.Set(key.Name, value)
		if err != nil {
			return err
		}
		shown := stored
		if key.Secret {
			shown = config.Mask(stored)
		}
		p, _ := config.Path()
		fmt.Printf("Set %s to %s in %s\n", key.Name, shown, p)
		if os.Getenv(key.Env) != "" {
			fmt.Printf("Note: %s is set in this shell and takes precedence over the file.\n", key.Env)
		}
		return nil

	case "unset", "rm":
		if len(rest) != 1 {
			return errors.New("usage: bug-trail config unset KEY")
		}
		had, err := config.Unset(rest[0])
		if err != nil {
			return err
		}
		if had {
			fmt.Printf("Removed %s from the config file\n", rest[0])
		} else {
			fmt.Printf("%s wasn't set in the config file\n", rest[0])
		}
		return nil
	}
	fmt.Fprint(os.Stderr, configHelp)
	return fmt.Errorf("unknown command %q for \"bug-trail config\"", verb)
}

// readValue reads a value from stdin. On a terminal it prompts, and hides what you type for
// secrets, so the token never reaches the shell history or the screen.
func readValue(k config.Key) (string, error) {
	st, err := os.Stdin.Stat()
	if err != nil {
		return "", err
	}
	tty := st.Mode()&os.ModeCharDevice != 0
	if tty {
		fmt.Fprintf(os.Stderr, "%s: ", k.Name)
		if k.Secret {
			if err := stty("-echo"); err == nil {
				defer func() { _ = stty("echo"); fmt.Fprintln(os.Stderr) }()
			}
		}
	}
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", fmt.Errorf("no value for %s on stdin", k.Name)
	}
	return strings.TrimSpace(line), nil
}

func stty(arg string) error {
	cmd := exec.Command("stty", arg)
	cmd.Stdin = os.Stdin
	return cmd.Run()
}
