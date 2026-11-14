// Package config stores bug-trail settings in a file, so the CLI works without exporting
// environment variables. A value is taken from, in order: a command-line flag, the environment
// variable, the config file, then the built-in default.
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// Key describes one setting.
type Key struct {
	Name   string
	Env    string
	Secret bool
	Help   string
}

// Keys are the settings the file can hold, in display order.
var Keys = []Key{
	{Name: "server", Env: "BUG_TRAIL_SERVER", Help: "Bug Trail server that `bug-trail push` uploads to, such as https://bugs.example.com"},
	{Name: "token", Env: "BUG_TRAIL_TOKEN", Secret: true, Help: "upload token for the server (and the token `bug-trail serve` accepts)"},
	{Name: "dir", Env: "BUG_TRAIL_DIR", Help: "folder where trail files are written and served from"},
}

// Lookup returns the key with that name.
func Lookup(name string) (Key, error) {
	for _, k := range Keys {
		if k.Name == name {
			return k, nil
		}
	}
	names := make([]string, len(Keys))
	for i, k := range Keys {
		names[i] = k.Name
	}
	return Key{}, fmt.Errorf("unknown setting %q: use %s", name, strings.Join(names, ", "))
}

// File is the on-disk config.
type File struct {
	Server string `json:"server,omitempty"`
	Token  string `json:"token,omitempty"`
	Dir    string `json:"dir,omitempty"`
}

func (f *File) field(name string) *string {
	switch name {
	case "server":
		return &f.Server
	case "token":
		return &f.Token
	case "dir":
		return &f.Dir
	}
	return nil
}

// Path is where the config file lives: $BUG_TRAIL_CONFIG, else $XDG_CONFIG_HOME/bug-trail/config.json,
// else ~/.config/bug-trail/config.json.
func Path() (string, error) {
	if p := os.Getenv("BUG_TRAIL_CONFIG"); p != "" {
		return p, nil
	}
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return filepath.Join(x, "bug-trail", "config.json"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", "bug-trail", "config.json"), nil
}

// Load reads the config file; a missing file is an empty config.
func Load() (File, error) {
	var f File
	p, err := Path()
	if err != nil {
		return f, err
	}
	b, err := os.ReadFile(p)
	if errors.Is(err, fs.ErrNotExist) {
		return f, nil
	}
	if err != nil {
		return f, err
	}
	if err := json.Unmarshal(b, &f); err != nil {
		return f, fmt.Errorf("%s: %w", p, err)
	}
	return f, nil
}

// Save writes the config file, readable only by its owner because it can hold a token.
func Save(f File) error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, append(b, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Normalize checks a value before it is stored: the server must be an http(s) URL, the
// directory becomes absolute.
func Normalize(name, value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%s can't be empty; use \"bug-trail config unset %s\" to remove it", name, name)
	}
	switch name {
	case "server":
		u, err := url.Parse(value)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			return "", fmt.Errorf("server must be an http(s) URL such as https://bugs.example.com, got %q", value)
		}
		return strings.TrimRight(value, "/"), nil
	case "dir":
		if rest, ok := strings.CutPrefix(value, "~"); ok && (rest == "" || strings.HasPrefix(rest, "/")) {
			home, err := os.UserHomeDir()
			if err != nil {
				return "", err
			}
			value = home + rest
		}
		return filepath.Abs(value)
	}
	return value, nil
}

// Set stores a value in the file.
func Set(name, value string) (string, error) {
	if _, err := Lookup(name); err != nil {
		return "", err
	}
	v, err := Normalize(name, value)
	if err != nil {
		return "", err
	}
	f, err := Load()
	if err != nil {
		return "", err
	}
	*f.field(name) = v
	return v, Save(f)
}

// Unset removes a value from the file. It reports whether there was one.
func Unset(name string) (bool, error) {
	if _, err := Lookup(name); err != nil {
		return false, err
	}
	f, err := Load()
	if err != nil {
		return false, err
	}
	had := *f.field(name) != ""
	*f.field(name) = ""
	return had, Save(f)
}

// Value is a resolved setting and where it came from.
type Value struct {
	Value  string
	Source string // "flag", "env BUG_TRAIL_…", "config", "default" or "" (not set)
}

// Resolve finds a setting: flag, then environment variable, then config file, then fallback.
func Resolve(name, flag, fallback string) (Value, error) {
	k, err := Lookup(name)
	if err != nil {
		return Value{}, err
	}
	if flag != "" {
		return Value{flag, "flag"}, nil
	}
	if v := os.Getenv(k.Env); v != "" {
		return Value{v, "env " + k.Env}, nil
	}
	f, err := Load()
	if err != nil {
		return Value{}, err
	}
	if v := *f.field(name); v != "" {
		return Value{v, "config"}, nil
	}
	if fallback != "" {
		return Value{fallback, "default"}, nil
	}
	return Value{}, nil
}

// Mask hides all but the last four characters of a secret.
func Mask(s string) string {
	if len(s) <= 4 {
		return strings.Repeat("•", len(s))
	}
	return strings.Repeat("•", 8) + s[len(s)-4:]
}

// Names lists the setting names.
func Names() []string {
	out := make([]string, len(Keys))
	for i, k := range Keys {
		out[i] = k.Name
	}
	return slices.Clip(out)
}
