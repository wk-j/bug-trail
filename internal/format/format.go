// Package format defines the bug-trail/v1 file format and its validator.
// It is the single source of truth: the dashboard's browser code receives
// these definitions from BrowserModule.
package format

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
)

const Format = "bug-trail/v1"

type Lane struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
}

// Lanes are the map's columns, left to right: the life of a bug.
var Lanes = []Lane{
	{"reported", "Reported", "How the bug entered the world"},
	{"observed", "Observed", "What actually goes wrong"},
	{"investigated", "Investigated", "Hypotheses, evidence, open questions"},
	{"cause", "Root cause", "Why it happens and where in the code"},
	{"resolution", "Resolution", "Fixes, PRs, commits, workarounds"},
	{"verified", "Verified", "Proof the fix works"},
}

// Kinds in display order; every kind lives in exactly one lane.
var Kinds = []string{
	"report", "environment", "symptom", "hypothesis", "evidence", "question",
	"root_cause", "code", "fix", "pr", "commit", "workaround", "verification",
}

var KindLane = map[string]string{
	"report": "reported", "environment": "reported",
	"symptom":    "observed",
	"hypothesis": "investigated", "evidence": "investigated", "question": "investigated",
	"root_cause": "cause", "code": "cause",
	"fix": "resolution", "pr": "resolution", "commit": "resolution", "workaround": "resolution",
	"verification": "verified",
}

var KindLabel = map[string]string{
	"report": "Report", "environment": "Environment", "symptom": "Symptom",
	"hypothesis": "Hypothesis", "evidence": "Evidence", "question": "Open question",
	"root_cause": "Root cause", "code": "Code location", "fix": "Fix",
	"pr": "Pull request", "commit": "Commit", "workaround": "Workaround",
	"verification": "Verification",
}

var (
	NodeStatus  = []string{"confirmed", "likely", "open", "rejected", "done"}
	Relations   = []string{"leads_to", "causes", "supports", "refutes", "fixes", "mitigates", "implements", "verifies", "blocks", "relates"}
	TrailStatus = []string{"new", "investigating", "root_caused", "fix_in_progress", "fixed", "wont_fix", "duplicate", "cannot_reproduce"}
	Severity    = []string{"critical", "high", "medium", "low"}
)

// Result holds validation messages. Slices are never nil so they encode as [].
type Result struct {
	Errors   []string `json:"errors"`
	Warnings []string `json:"warnings"`
}

var (
	repoRE = regexp.MustCompile(`^[^/\s]+/[^/\s]+$`)
	urlRE  = regexp.MustCompile(`^https?://`)
)

var dateLayouts = []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02"}

func isStr(v any) bool {
	s, ok := v.(string)
	return ok && strings.TrimSpace(s) != ""
}

func isDate(v any) bool {
	if !isStr(v) {
		return false
	}
	for _, l := range dateLayouts {
		if _, err := time.Parse(l, v.(string)); err == nil {
			return true
		}
	}
	return false
}

func isURL(v any) bool { return isStr(v) && urlRE.MatchString(v.(string)) }

func isInt(v any) bool {
	f, ok := v.(float64)
	return ok && f == math.Trunc(f) && !math.IsInf(f, 0)
}

func str(v any) string {
	if v == nil {
		return "undefined"
	}
	return fmt.Sprint(v)
}

func oneOf(v any, set []string) bool {
	s, ok := v.(string)
	return ok && slices.Contains(set, s)
}

func list(set []string) string { return strings.Join(set, ", ") }

// ValidateJSON parses and validates raw bytes.
func ValidateJSON(raw []byte) (any, Result) {
	var t any
	if err := json.Unmarshal(raw, &t); err != nil {
		return nil, Result{Errors: []string{"Invalid JSON: " + err.Error()}, Warnings: []string{}}
	}
	return t, Validate(t)
}

// Validate checks a decoded trail (as produced by encoding/json into any).
func Validate(v any) Result {
	r := Result{Errors: []string{}, Warnings: []string{}}
	errf := func(f string, a ...any) { r.Errors = append(r.Errors, fmt.Sprintf(f, a...)) }
	warnf := func(f string, a ...any) { r.Warnings = append(r.Warnings, fmt.Sprintf(f, a...)) }

	t, ok := v.(map[string]any)
	if !ok {
		errf("Top level must be a JSON object")
		return r
	}
	if t["format"] != Format {
		errf("format must be %q", Format)
	}
	if !isDate(t["analyzed_at"]) {
		errf("analyzed_at must be an ISO 8601 date-time")
	}
	if !isStr(t["analyzed_by"]) {
		warnf("analyzed_by is missing (which agent/model wrote this?)")
	}

	if i, ok := t["issue"].(map[string]any); !ok {
		errf("issue is required")
	} else {
		if !isURL(i["url"]) {
			errf("issue.url must be the issue URL")
		}
		if !isStr(i["repo"]) || !repoRE.MatchString(i["repo"].(string)) {
			errf(`issue.repo must look like "owner/name"`)
		}
		if !isInt(i["number"]) {
			errf("issue.number must be an integer")
		}
		if !isStr(i["title"]) {
			errf("issue.title is required")
		}
		if !oneOf(i["state"], []string{"open", "closed"}) {
			errf(`issue.state must be "open" or "closed"`)
		}
		for _, k := range []string{"created_at", "closed_at"} {
			if i[k] != nil && !isDate(i[k]) {
				errf("issue.%s must be a date", k)
			}
		}
		if i["labels"] != nil {
			if _, ok := i["labels"].([]any); !ok {
				errf("issue.labels must be an array of strings")
			}
		}
	}

	s, hasSummary := t["summary"].(map[string]any)
	if !hasSummary {
		errf("summary is required")
	} else {
		if !isStr(s["headline"]) {
			errf("summary.headline is required")
		}
		if !isStr(s["tldr"]) {
			errf("summary.tldr is required")
		}
		if !oneOf(s["status"], TrailStatus) {
			errf("summary.status must be one of: %s", list(TrailStatus))
		}
		if !oneOf(s["severity"], Severity) {
			errf("summary.severity must be one of: %s", list(Severity))
		}
		if c, ok := s["confidence"].(float64); !ok || c < 0 || c > 1 {
			errf("summary.confidence must be a number from 0 to 1")
		}
	}

	ids := map[string]bool{}
	var nodeIDs []string
	nodes, nodesOK := t["nodes"].([]any)
	if !nodesOK || len(nodes) == 0 {
		errf("nodes must be a non-empty array")
	} else {
		for k, nv := range nodes {
			at := fmt.Sprintf("nodes[%d]", k)
			n, ok := nv.(map[string]any)
			if !ok {
				errf("%s must be an object", at)
				continue
			}
			if !isStr(n["id"]) {
				errf("%s.id is required", at)
			} else if id := n["id"].(string); ids[id] {
				errf("%s.id %q is duplicated", at, id)
			} else {
				ids[id] = true
				nodeIDs = append(nodeIDs, id)
			}
			kind, _ := n["kind"].(string)
			if _, ok := KindLane[kind]; !ok {
				errf("%s.kind %q must be one of: %s", at, str(n["kind"]), list(Kinds))
			}
			if !isStr(n["title"]) {
				errf("%s.title is required", at)
			}
			if n["status"] != nil && !oneOf(n["status"], NodeStatus) {
				errf("%s.status must be one of: %s", at, list(NodeStatus))
			}
			if n["at"] != nil && !isDate(n["at"]) {
				errf("%s.at must be an ISO date", at)
			}
			refs, refsOK := n["refs"].([]any)
			if n["refs"] != nil {
				if !refsOK {
					errf("%s.refs must be an array", at)
				} else {
					for j, rv := range refs {
						ref, ok := rv.(map[string]any)
						if !ok || !isStr(ref["label"]) || !isURL(ref["url"]) {
							errf("%s.refs[%d] needs a label and an http(s) url", at, j)
						}
					}
				}
			}
			if kind != "hypothesis" && kind != "question" && len(refs) == 0 {
				warnf("node %q has no refs; link the comment, PR or commit it came from", str(n["id"]))
			}
		}
	}

	linked := map[string]bool{}
	if edges, ok := t["edges"].([]any); !ok {
		errf("edges must be an array")
	} else {
		for k, ev := range edges {
			at := fmt.Sprintf("edges[%d]", k)
			e, ok := ev.(map[string]any)
			if !ok {
				errf("%s must be an object", at)
				continue
			}
			from, _ := e["from"].(string)
			to, _ := e["to"].(string)
			if !ids[from] {
				errf("%s.from %q is not a node id", at, str(e["from"]))
			}
			if !ids[to] {
				errf("%s.to %q is not a node id", at, str(e["to"]))
			}
			if !oneOf(e["relation"], Relations) {
				errf("%s.relation must be one of: %s", at, list(Relations))
			}
			linked[from], linked[to] = true, true
		}
	}

	if t["story"] != nil {
		if story, ok := t["story"].([]any); !ok {
			errf("story must be an array of node ids")
		} else {
			for _, sv := range story {
				if id, _ := sv.(string); !ids[id] {
					errf("story references unknown node %q", str(sv))
				}
			}
		}
	} else {
		warnf("story is missing; the viewer cannot step through the main storyline")
	}

	if len(nodes) > 1 {
		for _, id := range nodeIDs {
			if !linked[id] {
				warnf("node %q is not connected to anything", id)
			}
		}
	}
	if hasSummary && oneOf(s["status"], []string{"root_caused", "fix_in_progress", "fixed"}) {
		hasRC := slices.ContainsFunc(nodes, func(nv any) bool {
			n, _ := nv.(map[string]any)
			return n != nil && n["kind"] == "root_cause"
		})
		if !hasRC {
			warnf("summary.status is %q but there is no root_cause node", s["status"])
		}
	}
	for _, key := range []string{"open_questions", "next_steps"} {
		if t[key] == nil {
			continue
		}
		arr, ok := t[key].([]any)
		if ok {
			for _, x := range arr {
				if !isStr(x) {
					ok = false
				}
			}
		}
		if !ok {
			errf("%s must be an array of strings", key)
		}
	}
	return r
}

// BrowserModule returns an ES module exposing the definitions the dashboard needs.
func BrowserModule() []byte {
	j := func(v any) string { b, _ := json.Marshal(v); return string(b) }
	return []byte(fmt.Sprintf(`// Generated by the bug-trail server from internal/format.
export const FORMAT = %s;
export const LANES = %s;
export const KIND_LANE = %s;
export const KIND_LABEL = %s;
export const NODE_STATUS = %s;
export const RELATIONS = %s;
export const TRAIL_STATUS = %s;
export const SEVERITY = %s;
`, j(Format), j(Lanes), j(KindLane), j(KindLabel), j(NodeStatus), j(Relations), j(TrailStatus), j(Severity)))
}
