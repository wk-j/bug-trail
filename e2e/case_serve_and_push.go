package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// serveAndPush is the shared-server path from docs/deploy.md: a team server
// with a token, an agent pushing a trail, the dashboard picking it up live.
var serveAndPush = Case{
	ID:    "serve-and-push",
	Title: "bug-trail push uploads a trail to bug-trail serve, which lists, serves and live-reloads it",
	Files: []string{"e2e/case_serve_and_push.go", "e2e/fixtures/invalid-trail.json", "examples/example__photo-sync__142.json"},
	Map:   "e2e/maps/bug-trail.toml",
	Run:   runServeAndPush,
}

const exampleID = "example__photo-sync__142"

func runServeAndPush(r *Run) {
	bin, ok := r.buildBugTrail()
	if !ok {
		return
	}
	trails := filepath.Join(r.Dir, "trails")
	token := randomToken()
	srv, ok := r.startServer(bin, trails, token, "server.log", "serve")
	if !ok {
		return
	}
	defer srv.stop()

	// The dashboard and its format module.
	if res, err := get(srv.URL + "/"); r.Check("dashboard", "dashboard", "GET / serves the dashboard HTML", err == nil && res.Status == 200 && strings.Contains(res.Header.Get("Content-Type"), "text/html"), statusDetail(res, err)) {
		r.SaveResponse("index.html", res.Body)
	}
	res, err := get(srv.URL + "/format.js")
	r.Check("format-js", "dashboard", "GET /format.js serves the format as a JavaScript module", err == nil && res.Status == 200 && strings.Contains(res.Body, "bug-trail/v2"), statusDetail(res, err))
	res, err = get(srv.URL + "/no-such-file.js")
	r.Check("dashboard", "dashboard", "an unknown path answers 404", err == nil && res.Status == 404, statusDetail(res, err))

	res, err = get(srv.URL + "/api/trails")
	r.Check("api-list", "api", "GET /api/trails is empty on a fresh folder", err == nil && res.Status == 200 && countTrails(res.Body) == 0, statusDetail(res, err))

	ev, closeEv, err := events(srv.URL)
	if err != nil {
		r.Check("events", "live reload", "GET /events opens a stream", false, err.Error())
	} else {
		defer closeEv()
	}

	// bug-trail push, as an agent runs it.
	example := filepath.Join(r.Root, "examples", exampleID+".json")
	out, code := r.cli(bin, "push-ok.log", r.isolatedEnv(), "push", "--server", srv.URL, "--token", token, example)
	r.Check("cli-push", "push", "bug-trail push uploads a valid trail and exits 0", code == 0 && strings.Contains(out, "✓"), short(out))
	_, statErr := os.Stat(filepath.Join(trails, exampleID+".json"))
	r.Check("store", "push", "the trail is written to the server's folder as <id>.json", statErr == nil, errString(statErr))

	if ev != nil {
		ok, detail := waitEvent(ev, exampleID, 5*time.Second)
		r.Check("events", "live reload", "GET /events announces the uploaded trail", ok, detail)
	}

	res, err = get(srv.URL + "/api/trails")
	r.SaveResponse("trails.json", res.Body)
	r.Check("api-list", "api", "GET /api/trails lists the pushed trail", err == nil && res.Status == 200 && countTrails(res.Body) == 1 && strings.Contains(res.Body, exampleID), statusDetail(res, err))

	res, err = get(srv.URL + "/api/trails/" + exampleID)
	r.SaveResponse("trail.json", res.Body)
	var one struct {
		ID         string
		Trail      map[string]any
		Validation struct{ Errors []string }
	}
	_ = json.Unmarshal([]byte(res.Body), &one)
	r.Check("api-get", "api", "GET /api/trails/{id} returns the trail with no validation errors", err == nil && res.Status == 200 && one.ID == exampleID && one.Trail["format"] == "bug-trail/v2" && len(one.Validation.Errors) == 0, statusDetail(res, err))

	// What the server refuses.
	out, code = r.cli(bin, "push-wrong-token.log", r.isolatedEnv(), "push", "--server", srv.URL, "--token", "wrong-"+token, example)
	r.Check("auth", "refusals", "push with a wrong token fails with 401", code != 0 && strings.Contains(out, "401"), short(out))

	invalid := filepath.Join(r.Root, "e2e", "fixtures", "invalid-trail.json")
	out, code = r.cli(bin, "push-invalid.log", r.isolatedEnv(), "push", "--server", srv.URL, "--token", token, invalid)
	_, statErr = os.Stat(filepath.Join(trails, "invalid-trail.json"))
	r.Check("cli-push", "refusals", "push refuses a trail with format errors before uploading", code != 0 && strings.Contains(out, "format errors") && statErr != nil, short(out))

	raw, _ := os.ReadFile(invalid)
	res, err = do(http.MethodPut, srv.URL+"/api/trails/invalid-trail", token, string(raw))
	r.Check("api-put", "refusals", "PUT of an invalid trail answers 422 with the validation", err == nil && res.Status == 422 && strings.Contains(res.Body, "validation"), statusDetail(res, err))

	res, err = do(http.MethodDelete, srv.URL+"/api/trails/"+exampleID, "", "")
	r.Check("auth", "refusals", "DELETE without a token answers 401", err == nil && res.Status == 401, statusDetail(res, err))

	// Replace, then delete.
	good, _ := os.ReadFile(example)
	res, err = do(http.MethodPut, srv.URL+"/api/trails/"+exampleID, token, string(good))
	r.Check("api-put", "api", "PUT of an existing trail answers 200 (replaced)", err == nil && res.Status == 200, statusDetail(res, err))

	res, err = do(http.MethodDelete, srv.URL+"/api/trails/"+exampleID, token, "")
	r.Check("api-delete", "api", "DELETE with the token answers 204", err == nil && res.Status == 204, statusDetail(res, err))
	res, err = get(srv.URL + "/api/trails/" + exampleID)
	r.Check("api-get", "api", "the deleted trail answers 404", err == nil && res.Status == 404, statusDetail(res, err))
	if ev != nil {
		ok, detail := waitEvent(ev, exampleID, 5*time.Second)
		r.Check("events", "live reload", "GET /events announces the deletion", ok, detail)
	}
}

func countTrails(body string) int {
	var v struct{ Trails []json.RawMessage }
	if json.Unmarshal([]byte(body), &v) != nil {
		return -1
	}
	return len(v.Trails)
}

func statusDetail(res response, err error) string {
	if err != nil {
		return err.Error()
	}
	return http.StatusText(res.Status) + " " + short(res.Body)
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
