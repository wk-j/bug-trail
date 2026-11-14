package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// isolate points the config file and the variables at a temp dir for one test.
func isolate(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "cfg", "config.json")
	t.Setenv("BUG_TRAIL_CONFIG", p)
	for _, k := range Keys {
		t.Setenv(k.Env, "")
	}
	return p
}

func TestSetGetUnset(t *testing.T) {
	p := isolate(t)
	if v, _ := Resolve("server", "", ""); v.Value != "" || v.Source != "" {
		t.Fatalf("empty config: %+v", v)
	}
	got, err := Set("server", "https://bugs.example.com/")
	if err != nil || got != "https://bugs.example.com" {
		t.Fatalf("set server: %q %v", got, err)
	}
	if v, _ := Resolve("server", "", ""); v.Value != "https://bugs.example.com" || v.Source != "config" {
		t.Fatalf("from config: %+v", v)
	}
	if _, err := Set("token", "s3cret-token"); err != nil {
		t.Fatal(err)
	}
	st, err := os.Stat(p)
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("config file must be private (0600): %v %v", st.Mode().Perm(), err)
	}
	if had, _ := Unset("server"); !had {
		t.Fatal("unset should report the old value")
	}
	if v, _ := Resolve("server", "", ""); v.Value != "" {
		t.Fatalf("after unset: %+v", v)
	}
	if v, _ := Resolve("token", "", ""); v.Value != "s3cret-token" {
		t.Fatalf("unset server must keep the token: %+v", v)
	}
}

func TestPrecedence(t *testing.T) {
	isolate(t)
	_, _ = Set("server", "https://from-config.example")
	t.Setenv("BUG_TRAIL_SERVER", "https://from-env.example")
	if v, _ := Resolve("server", "", ""); v.Value != "https://from-env.example" || v.Source != "env BUG_TRAIL_SERVER" {
		t.Fatalf("env beats config: %+v", v)
	}
	if v, _ := Resolve("server", "https://from-flag.example", ""); v.Source != "flag" {
		t.Fatalf("flag beats env: %+v", v)
	}
	t.Setenv("BUG_TRAIL_SERVER", "")
	if v, _ := Resolve("dir", "", "/default/dir"); v.Value != "/default/dir" || v.Source != "default" {
		t.Fatalf("default: %+v", v)
	}
}

func TestValidation(t *testing.T) {
	isolate(t)
	for _, bad := range []string{"bugs.example.com", "ftp://x", "https://", "  "} {
		if _, err := Set("server", bad); err == nil {
			t.Errorf("server %q should be rejected", bad)
		}
	}
	if _, err := Set("colour", "red"); err == nil || !strings.Contains(err.Error(), "unknown setting") {
		t.Errorf("unknown key: %v", err)
	}
	home, _ := os.UserHomeDir()
	if got, _ := Set("dir", "~/trails"); got != filepath.Join(home, "trails") {
		t.Errorf("~ should expand: %q", got)
	}
}

func TestMask(t *testing.T) {
	if got := Mask("abcdef123456"); got != "••••••••3456" {
		t.Errorf("mask: %q", got)
	}
	if got := Mask("ab"); got != "••" {
		t.Errorf("short mask: %q", got)
	}
}

func TestBrokenFileIsReported(t *testing.T) {
	p := isolate(t)
	_ = os.MkdirAll(filepath.Dir(p), 0o700)
	_ = os.WriteFile(p, []byte("{not json"), 0o600)
	if _, err := Resolve("server", "", ""); err == nil || !strings.Contains(err.Error(), p) {
		t.Fatalf("want an error naming the file, got %v", err)
	}
}
