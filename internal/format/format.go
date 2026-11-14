// Package format defines the bug-trail file format (v2, reading v1 too) and its validator.
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

// Format is the current version. v2 adds "flow": the code path the bug takes
// through the application. v1 files (no flow) still load, with a warning.
const (
	Format   = "bug-trail/v2"
	FormatV1 = "bug-trail/v1"
)

// Flow vocabulary.
var (
	// StepRoles say what a step has to do with the bug.
	StepRoles = []string{"normal", "origin", "propagates", "symptom", "concurrent"}
	// BugRoles are the roles on the bug's path, origin to symptom.
	BugRoles       = []string{"origin", "propagates", "symptom"}
	ComponentKinds = []string{"app", "library", "service", "storage", "external", "process"}
	// StepPaths say which flow a step belongs to: both, only the correct logic, or only
	// what the buggy code does. The map draws correct and bug steps in separate bands.
	StepPaths     = []string{"both", "correct", "bug"}
	FlowEdgeKinds = []string{"call", "data", "return", "error", "concurrent"}
)

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
	isV2 := t["format"] == Format
	if !isV2 && t["format"] != FormatV1 {
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
	// nodes/edges hold the investigation (hypotheses, evidence, PRs). Required in v1,
	// optional in v2 where the flow is the main picture.
	nodes, nodesOK := t["nodes"].([]any)
	if !isV2 && (!nodesOK || len(nodes) == 0) {
		errf("nodes must be a non-empty array")
	} else if t["nodes"] != nil && !nodesOK {
		errf("nodes must be an array")
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
		if !isV2 || t["edges"] != nil {
			errf("edges must be an array")
		}
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
		if !isV2 {
			warnf("story is missing; the viewer cannot step through the main storyline")
		}
	}

	if len(nodes) > 1 {
		for _, id := range nodeIDs {
			if !linked[id] {
				warnf("node %q is not connected to anything", id)
			}
		}
	}
	if hasSummary && !isV2 && oneOf(s["status"], []string{"root_caused", "fix_in_progress", "fixed"}) {
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
	if isV2 {
		validateFlow(t["flow"], errf, warnf)
	} else {
		warnf("this is a v1 trail with no code flow; run the bug-trail skill again to map the code path")
	}
	return r
}

// validateCases checks the concrete inputs: each names the steps the correct logic
// takes and the steps the current code takes for that input.
func validateCases(v any, stepIDs map[string]bool, stepPath map[string]string, errf, warnf func(string, ...any)) {
	if v == nil {
		return
	}
	cases, ok := v.([]any)
	if !ok {
		errf("flow.cases must be an array")
		return
	}
	seen := map[string]bool{}
	for k, cv := range cases {
		at := fmt.Sprintf("flow.cases[%d]", k)
		c, ok := cv.(map[string]any)
		if !ok {
			errf("%s must be an object", at)
			continue
		}
		id, _ := c["id"].(string)
		if !isStr(id) {
			errf("%s.id is required", at)
		} else if seen[id] {
			errf("%s.id %q is duplicated", at, id)
		}
		seen[id] = true
		if !isStr(c["title"]) {
			errf("%s.title is required", at)
		}
		for _, f := range []string{"should", "does"} {
			if !isStr(c[f]) {
				errf("%s.%s is required: the outcome in one sentence", at, f)
			}
		}
		if c["works"] != nil {
			if _, ok := c["works"].(bool); !ok {
				errf("%s.works must be true or false", at)
			}
		}
		if c["input"] != nil {
			if _, ok := c["input"].(map[string]any); !ok {
				errf("%s.input must be an object of field: value", at)
			}
		}
		for _, route := range []string{"correct", "bug"} {
			ids, ok := c[route].([]any)
			if !ok || len(ids) == 0 {
				errf("%s.%s must list the step ids this input goes through", at, route)
				continue
			}
			for _, sv := range ids {
				sid, _ := sv.(string)
				switch {
				case !stepIDs[sid]:
					errf("%s.%s names unknown step %q", at, route, str(sv))
				case route == "correct" && stepPath[sid] == "bug":
					errf("%s.correct includes %q, which is a bug-only step", at, sid)
				case route == "bug" && stepPath[sid] == "correct":
					errf("%s.bug includes %q, which is a correct-only step", at, sid)
				}
			}
		}
	}
}

func validateRefs(at string, v any, errf func(string, ...any)) int {
	if v == nil {
		return 0
	}
	refs, ok := v.([]any)
	if !ok {
		errf("%s.refs must be an array", at)
		return 0
	}
	for j, rv := range refs {
		ref, ok := rv.(map[string]any)
		if !ok || !isStr(ref["label"]) || !isURL(ref["url"]) {
			errf("%s.refs[%d] needs a label and an http(s) url", at, j)
		}
	}
	return len(refs)
}

// validateFlow checks the code path: components (columns) and steps (rows, in
// execution order) with the role each step plays in the bug.
func validateFlow(v any, errf, warnf func(string, ...any)) {
	f, ok := v.(map[string]any)
	if !ok {
		errf("flow is required: the components and steps of the code path the bug takes")
		return
	}
	if !isStr(f["title"]) {
		warnf("flow.title is missing (for example: what happens when you run the failing command)")
	}

	compKind := map[string]string{}
	comps, ok := f["components"].([]any)
	if !ok || len(comps) == 0 {
		errf("flow.components must be a non-empty array")
	}
	for k, cv := range comps {
		at := fmt.Sprintf("flow.components[%d]", k)
		c, ok := cv.(map[string]any)
		if !ok {
			errf("%s must be an object", at)
			continue
		}
		id, _ := c["id"].(string)
		switch {
		case !isStr(id):
			errf("%s.id is required", at)
		case compKind[id] != "":
			errf("%s.id %q is duplicated", at, id)
		default:
			kind, _ := c["kind"].(string)
			if kind == "" {
				kind = "app"
			}
			compKind[id] = kind
		}
		if !isStr(c["name"]) {
			errf("%s.name is required", at)
		}
		if c["group"] != nil && !isStr(c["group"]) {
			errf("%s.group must be a string (the module or repo the component belongs to)", at)
		}
		if c["kind"] != nil && !oneOf(c["kind"], ComponentKinds) {
			errf("%s.kind must be one of: %s", at, list(ComponentKinds))
		}
	}

	stepIDs := map[string]bool{}
	stepPath := map[string]string{}
	roles := map[string]int{}
	steps, ok := f["steps"].([]any)
	if !ok || len(steps) < 2 {
		errf("flow.steps must list at least 2 steps, in the order the code runs")
	}
	for k, sv := range steps {
		at := fmt.Sprintf("flow.steps[%d]", k)
		s, ok := sv.(map[string]any)
		if !ok {
			errf("%s must be an object", at)
			continue
		}
		id, _ := s["id"].(string)
		switch {
		case !isStr(id):
			errf("%s.id is required", at)
		case stepIDs[id]:
			errf("%s.id %q is duplicated", at, id)
		}
		comp, _ := s["component"].(string)
		if compKind[comp] == "" {
			errf("%s.component %q is not a component id", at, str(s["component"]))
		}
		if !isStr(s["title"]) {
			errf("%s.title is required", at)
		}
		role := "normal"
		if s["role"] != nil {
			if !oneOf(s["role"], StepRoles) {
				errf("%s.role must be one of: %s", at, list(StepRoles))
			} else {
				role = s["role"].(string)
			}
		}
		roles[role]++
		path := "both"
		if s["path"] != nil {
			if !oneOf(s["path"], StepPaths) {
				errf("%s.path must be one of: %s", at, list(StepPaths))
			} else {
				path = s["path"].(string)
			}
		}
		if path == "correct" && slices.Contains(BugRoles, role) {
			errf("%s is on the correct path, so its role can't be %q", at, role)
		}
		if isStr(id) {
			stepPath[id] = path
		}
		if s["location"] != nil {
			loc, ok := s["location"].(map[string]any)
			if !ok || !isStr(loc["path"]) {
				errf("%s.location needs a path", at)
			} else {
				if loc["line"] != nil && !isInt(loc["line"]) {
					errf("%s.location.line must be an integer", at)
				}
				if loc["url"] != nil && !isURL(loc["url"]) {
					errf("%s.location.url must be an http(s) url", at)
				}
			}
		} else if slices.Contains(BugRoles, role) && compKind[comp] != "external" && compKind[comp] != "process" && compKind[comp] != "storage" {
			warnf("step %q is on the bug path but has no code location", str(s["id"]))
		}
		if s["snippet"] != nil && !isStr(s["snippet"]) {
			errf("%s.snippet must be a string", at)
		}
		if s["fix"] != nil {
			fx, ok := s["fix"].(map[string]any)
			if !ok || !isStr(fx["label"]) {
				errf("%s.fix needs a label", at)
			} else if fx["url"] != nil && !isURL(fx["url"]) {
				errf("%s.fix.url must be an http(s) url", at)
			}
		}
		if s["alongside"] != nil {
			if a, _ := s["alongside"].(string); !stepIDs[a] {
				errf("%s.alongside must name an earlier step", at)
			}
		}
		validateRefs(at, s["refs"], errf)
		if isStr(id) {
			stepIDs[id] = true
		}
	}

	if f["edges"] != nil {
		edges, ok := f["edges"].([]any)
		if !ok {
			errf("flow.edges must be an array")
		}
		for k, ev := range edges {
			at := fmt.Sprintf("flow.edges[%d]", k)
			e, ok := ev.(map[string]any)
			if !ok {
				errf("%s must be an object", at)
				continue
			}
			for _, end := range []string{"from", "to"} {
				if id, _ := e[end].(string); !stepIDs[id] {
					errf("%s.%s %q is not a step id", at, end, str(e[end]))
				}
			}
			if e["kind"] != nil && !oneOf(e["kind"], FlowEdgeKinds) {
				errf("%s.kind must be one of: %s", at, list(FlowEdgeKinds))
			}
		}
	}

	hasCorrect := false
	for _, p := range stepPath {
		if p == "correct" {
			hasCorrect = true
		}
	}
	validateCases(f["cases"], stepIDs, stepPath, errf, warnf)
	if len(steps) >= 2 && !hasCorrect {
		warnf(`no flow step has path "correct"; add the correct logic so the map can show it next to the bug`)
	}
	if hasCorrect && f["cases"] == nil {
		warnf("flow.cases is missing; add concrete inputs and the route each one takes")
	}

	if len(steps) >= 2 {
		if roles["origin"] == 0 {
			warnf(`no flow step has role "origin"; mark the step where the bug starts`)
		}
		if roles["symptom"] == 0 {
			warnf(`no flow step has role "symptom"; mark the step where the user sees the bug`)
		}
	}
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
export const STEP_ROLES = %s;
export const BUG_ROLES = %s;
export const STEP_PATHS = %s;
`, j(Format), j(Lanes), j(KindLane), j(KindLabel), j(NodeStatus), j(Relations), j(TrailStatus), j(Severity), j(StepRoles), j(BugRoles), j(StepPaths)))
}
