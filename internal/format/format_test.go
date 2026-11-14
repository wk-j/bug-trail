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
	  "format": "bug-trail/v2", "analyzed_at": "2026-11-14T09:00:00Z", "analyzed_by": "test",
	  "issue": {"url": "https://github.com/o/r/issues/1", "repo": "o/r", "number": 1, "title": "x", "state": "open"},
	  "summary": {"headline": "h", "tldr": "t", "status": "new", "severity": "low", "confidence": 0.5},
	  "flow": {
	    "title": "Saving a file",
	    "components": [{"id": "ui", "name": "Editor", "kind": "app"}, {"id": "fs", "name": "File writer", "kind": "library"}],
	    "steps": [
	      {"id": "s1", "component": "ui", "title": "User saves", "role": "normal"},
	      {"id": "s2", "component": "fs", "title": "Name cut mid-codepoint", "role": "origin",
	       "location": {"path": "fs/name.go", "line": 12, "url": "https://github.com/o/r/blob/abc/fs/name.go#L12"},
	       "fix": {"label": "PR #2", "url": "https://github.com/o/r/pull/2"}},
	      {"id": "s3", "component": "ui", "title": "Crash dialog", "role": "symptom", "location": {"path": "ui/save.go"}}
	    ],
	    "edges": [{"from": "s1", "to": "s2", "kind": "call"}, {"from": "s2", "to": "s3", "kind": "error"}]
	  },
	  "nodes": [
	    {"id": "a", "kind": "report", "title": "A", "refs": [{"label": "issue", "url": "https://github.com/o/r/issues/1"}]},
	    {"id": "b", "kind": "hypothesis", "title": "B"}
	  ],
	  "edges": [{"from": "a", "to": "b", "relation": "leads_to"}],
	  "story": ["a", "b"]
	}`), &t)
	return t
}

func flow(m map[string]any) map[string]any { return m["flow"].(map[string]any) }
func step(m map[string]any, i int) map[string]any {
	return flow(m)["steps"].([]any)[i].(map[string]any)
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(map[string]any)
		want   string // substring of an error; "" means valid with no warnings
	}{
		{"minimal", func(map[string]any) {}, ""},
		{"date-only is fine", func(m map[string]any) { m["analyzed_at"] = "2026-11-14" }, ""},
		{"no investigation is fine in v2", func(m map[string]any) { delete(m, "nodes"); delete(m, "edges"); delete(m, "story") }, ""},
		{"wrong format", func(m map[string]any) { m["format"] = "v0" }, "format must be"},
		{"fractional number", func(m map[string]any) { m["issue"].(map[string]any)["number"] = 1.5 }, "issue.number"},
		{"confidence range", func(m map[string]any) { m["summary"].(map[string]any)["confidence"] = 2.0 }, "confidence"},
		{"unknown kind", func(m map[string]any) { m["nodes"].([]any)[1].(map[string]any)["kind"] = "thing" }, `kind "thing"`},
		{"dangling edge", func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["to"] = "zz" }, `to "zz"`},
		{"bad relation", func(m map[string]any) { m["edges"].([]any)[0].(map[string]any)["relation"] = "eats" }, "relation must be"},
		{"story unknown id", func(m map[string]any) { m["story"] = []any{"a", "q"} }, `unknown node "q"`},
		{"duplicate id", func(m map[string]any) { m["nodes"].([]any)[1].(map[string]any)["id"] = "a" }, "duplicated"},
		{"flow missing", func(m map[string]any) { delete(m, "flow") }, "flow is required"},
		{"one step", func(m map[string]any) { flow(m)["steps"] = flow(m)["steps"].([]any)[:1] }, "at least 2 steps"},
		{"unknown component", func(m map[string]any) { step(m, 0)["component"] = "db" }, `component "db"`},
		{"bad role", func(m map[string]any) { step(m, 0)["role"] = "culprit" }, "role must be"},
		{"location without path", func(m map[string]any) { step(m, 1)["location"] = map[string]any{"line": 3.0} }, "location needs a path"},
		{"fix without label", func(m map[string]any) { step(m, 1)["fix"] = map[string]any{} }, "fix needs a label"},
		{"alongside a later step", func(m map[string]any) { step(m, 0)["alongside"] = "s3" }, "earlier step"},
		{"flow edge to nowhere", func(m map[string]any) { flow(m)["edges"].([]any)[0].(map[string]any)["to"] = "s9" }, `to "s9"`},
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

func TestV1StillLoads(t *testing.T) {
	m := minimal()
	m["format"] = "bug-trail/v1"
	delete(m, "flow")
	r := Validate(m)
	if len(r.Errors) != 0 || !strings.Contains(strings.Join(r.Warnings, "\n"), "no code flow") {
		t.Fatalf("v1: errors=%v warnings=%v", r.Errors, r.Warnings)
	}
}

func TestFlowWarnings(t *testing.T) {
	m := minimal()
	step(m, 1)["role"] = "normal"
	delete(step(m, 2), "location")
	step(m, 2)["role"] = "propagates"
	all := strings.Join(Validate(m).Warnings, "\n")
	for _, w := range []string{`role "origin"`, `role "symptom"`, `"s3" is on the bug path but has no code location`} {
		if !strings.Contains(all, w) {
			t.Errorf("missing warning %q in %s", w, all)
		}
	}
}

func TestV1Warnings(t *testing.T) {
	m := minimal()
	m["format"] = "bug-trail/v1"
	delete(m, "flow")
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
