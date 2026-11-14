package format

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExamplesAreValid(t *testing.T) {
	files, _ := filepath.Glob("../../examples/*.json")
	if len(files) == 0 {
		t.Fatal("no example trails found")
	}
	for _, f := range files {
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		if _, r := ValidateJSON(raw); len(r.Errors) > 0 {
			t.Errorf("%s: %v", f, r.Errors)
		}
	}
}

func minimal() map[string]any {
	var t map[string]any
	_ = json.Unmarshal([]byte(`{
	  "format": "bug-trail/v1", "analyzed_at": "2026-11-14T09:00:00Z", "analyzed_by": "test",
	  "issue": {"url": "https://github.com/o/r/issues/1", "repo": "o/r", "number": 1, "title": "x", "state": "open"},
	  "summary": {"headline": "h", "tldr": "t", "status": "new", "severity": "low", "confidence": 0.5},
	  "nodes": [
	    {"id": "a", "kind": "report", "title": "A", "refs": [{"label": "issue", "url": "https://github.com/o/r/issues/1"}]},
	    {"id": "b", "kind": "hypothesis", "title": "B"}
	  ],
	  "edges": [{"from": "a", "to": "b", "relation": "leads_to"}],
	  "story": ["a", "b"]
	}`), &t)
	return t
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]any)
		want   string // substring of an error; "" means valid with no warnings
	}{
		{"minimal", func(map[string]any) {}, ""},
		{"date-only is fine", func(m map[string]any) { m["analyzed_at"] = "2026-11-14" }, ""},
		{"wrong format", func(m map[string]any) { m["format"] = "v0" }, "format must be"},
		{"fractional number", func(m map[string]any) { m["issue"].(map[string]any)["number"] = 1.5 }, "issue.number"},
		{"confidence range", func(m map[string]any) { m["summary"].(map[string]any)["confidence"] = 2.0 }, "confidence"},
		{"unknown kind", func(m map[string]any) { m["nodes"].([]any)[1].(map[string]any)["kind"] = "thing" }, `kind "thing"`},
		{"dangling edge", func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["to"] = "zz" }, `to "zz"`},
		{"bad relation", func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["relation"] = "eats" }, "relation must be"},
		{"story unknown id", func(m map[string]any) { m["story"] = []any{"a", "q"} }, `unknown node "q"`},
		{"duplicate id", func(m map[string]any) { m["nodes"].([]any)[1].(map[string]any)["id"] = "a" }, "duplicated"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := minimal()
			c.mutate(m)
			r := Validate(m)
			if c.want == "" {
				if len(r.Errors)+len(r.Warnings) > 0 {
					t.Fatalf("want clean, got errors=%v warnings=%v", r.Errors, r.Warnings)
				}
				return
			}
			if !strings.Contains(strings.Join(r.Errors, "\n"), c.want) {
				t.Fatalf("want an error containing %q, got %v", c.want, r.Errors)
			}
		})
	}
}

func TestWarnings(t *testing.T) {
	m := minimal()
	delete(m, "story")
	m["summary"].(map[string]any)["status"] = "fixed"
	r := Validate(m)
	if len(r.Errors) != 0 {
		t.Fatalf("unexpected errors: %v", r.Errors)
	}
	all := strings.Join(r.Warnings, "\n")
	for _, w := range []string{"story is missing", "no root_cause node"} {
		if !strings.Contains(all, w) {
			t.Errorf("missing warning %q in %v", w, r.Warnings)
		}
	}
}

func TestBrowserModuleCoversEveryKind(t *testing.T) {
	js := string(BrowserModule())
	for _, k := range Kinds {
		if !strings.Contains(js, `"`+k+`"`) {
			t.Errorf("kind %q missing from browser module", k)
		}
	}
}
