package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server, context.CancelFunc) {
	t.Helper()
	dir := t.TempDir()
	raw, err := os.ReadFile("../../examples/example__photo-sync__142.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "ex.json"), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(dir, "broken.json"), []byte("{nope"), 0o644)
	s := &Server{Dir: dir, Web: fstest.MapFS{
		"index.html":    {Data: []byte("<html>")},
		"ui/button.js":  {Data: []byte("export const x = 1;")},
		"ui/tokens.css": {Data: []byte(":root{}")},
	}, clients: map[chan string]struct{}{}}
	ctx, cancel := context.WithCancel(context.Background())
	go s.watch(ctx)
	ts := httptest.NewServer(s.handler())
	t.Cleanup(func() { cancel(); ts.Close() })
	return s, ts, cancel
}

func getJSON(t *testing.T, url string, v any) int {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	_ = json.NewDecoder(res.Body).Decode(v)
	return res.StatusCode
}

func TestAPI(t *testing.T) {
	_, ts, _ := newTestServer(t)

	var list struct {
		Trails []trailSummary `json:"trails"`
	}
	getJSON(t, ts.URL+"/api/trails", &list)
	if len(list.Trails) != 2 {
		t.Fatalf("want 2 trails, got %d", len(list.Trails))
	}

	var one trailResponse
	if code := getJSON(t, ts.URL+"/api/trails/ex", &one); code != 200 || len(one.Validation.Errors) != 0 {
		t.Fatalf("ex: code=%d errors=%v", code, one.Validation.Errors)
	}
	var bad trailResponse
	getJSON(t, ts.URL+"/api/trails/broken", &bad)
	if bad.Trail != nil || len(bad.Validation.Errors) != 1 {
		t.Fatalf("broken: want one JSON error, got %+v", bad.Validation)
	}
	var missing map[string]string
	if code := getJSON(t, ts.URL+"/api/trails/..%2fetc", &missing); code != 404 {
		t.Fatalf("path traversal id: want 404, got %d", code)
	}
	for path, want := range map[string]string{"/ui/button.js": "javascript", "/ui/tokens.css": "text/css"} {
		r, _ := http.Get(ts.URL + path)
		if r.StatusCode != 200 || !strings.Contains(r.Header.Get("Content-Type"), want) {
			t.Fatalf("%s: %d %s", path, r.StatusCode, r.Header.Get("Content-Type"))
		}
		r.Body.Close()
	}
	if r, _ := http.Get(ts.URL + "/ui/missing.js"); r.StatusCode != 404 {
		t.Fatalf("missing static file: want 404, got %d", r.StatusCode)
	}
	res, _ := http.Get(ts.URL + "/format.js")
	if res.StatusCode != 200 || !strings.Contains(res.Header.Get("Content-Type"), "javascript") {
		t.Fatalf("format.js: %d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
	res.Body.Close()
}

func TestEventsOnFileChange(t *testing.T) {
	s, ts, _ := newTestServer(t)
	res, err := http.Get(ts.URL + "/events")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	lines := make(chan string, 8)
	go func() {
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			lines <- sc.Text()
		}
	}()
	time.Sleep(500 * time.Millisecond) // let the watcher take its first snapshot
	if err := os.WriteFile(filepath.Join(s.Dir, "new.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	deadline := time.After(3 * time.Second)
	for {
		select {
		case l := <-lines:
			if l == `data: {"id":"new"}` {
				return
			}
		case <-deadline:
			t.Fatal("no event for new.json")
		}
	}
}

func do(t *testing.T, method, url, token, body string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, url, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res
}

func TestUploads(t *testing.T) {
	s, ts, _ := newTestServer(t)
	good, _ := os.ReadFile("../../examples/example__photo-sync__142.json")
	url := ts.URL + "/api/trails/o__r__1"

	if c := do(t, "PUT", url, "x", string(good)).StatusCode; c != 403 {
		t.Fatalf("no server token: want 403, got %d", c)
	}
	s.Token = "secret"
	if c := do(t, "PUT", url, "", string(good)).StatusCode; c != 401 {
		t.Fatalf("missing token: want 401, got %d", c)
	}
	if c := do(t, "PUT", url, "wrong", string(good)).StatusCode; c != 401 {
		t.Fatalf("wrong token: want 401, got %d", c)
	}
	if c := do(t, "PUT", url, "secret", `{"format":"nope"}`).StatusCode; c != 422 {
		t.Fatalf("invalid trail: want 422, got %d", c)
	}
	if c := do(t, "PUT", ts.URL+"/api/trails/bad%20id", "secret", string(good)).StatusCode; c != 400 {
		t.Fatalf("bad id: want 400, got %d", c)
	}
	if c := do(t, "PUT", url, "secret", string(good)).StatusCode; c != 201 {
		t.Fatalf("create: want 201, got %d", c)
	}
	if c := do(t, "PUT", url, "secret", string(good)).StatusCode; c != 200 {
		t.Fatalf("update: want 200, got %d", c)
	}
	if b, _ := os.ReadFile(filepath.Join(s.Dir, "o__r__1.json")); string(b) != string(good) {
		t.Fatal("stored file differs from upload")
	}
	if left, _ := filepath.Glob(filepath.Join(s.Dir, ".upload-*")); len(left) != 0 {
		t.Fatalf("temp files left behind: %v", left)
	}
	if c := do(t, "PUT", url, "secret", strings.Repeat(" ", MaxUpload+1)).StatusCode; c != 413 {
		t.Fatalf("oversize: want 413, got %d", c)
	}
	if c := do(t, "DELETE", url, "secret", "").StatusCode; c != 204 {
		t.Fatalf("delete: want 204, got %d", c)
	}
	if c := do(t, "DELETE", url, "secret", "").StatusCode; c != 404 {
		t.Fatalf("delete again: want 404, got %d", c)
	}
	if c := do(t, "GET", ts.URL+"/healthz", "", "").StatusCode; c != 200 {
		t.Fatalf("healthz: want 200, got %d", c)
	}
}

func TestListNewestFirst(t *testing.T) {
	dir := t.TempDir()
	raw, err := os.ReadFile("../../examples/example__photo-sync__142.json")
	if err != nil {
		t.Fatal(err)
	}
	// Each file keeps the example's analyzed_at; only the write time says which is newest.
	base := time.Now().Add(-time.Hour)
	for i, id := range []string{"old", "newest", "middle"} {
		p := filepath.Join(dir, id+".json")
		if err := os.WriteFile(p, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		at := base.Add(map[int]time.Duration{0: 0, 1: 20 * time.Minute, 2: 10 * time.Minute}[i])
		if err := os.Chtimes(p, at, at); err != nil {
			t.Fatal(err)
		}
	}
	var got []string
	for _, s := range (&Server{Dir: dir}).listTrails() {
		got = append(got, s.ID)
	}
	if strings.Join(got, ",") != "newest,middle,old" {
		t.Fatalf("want newest,middle,old, got %v", got)
	}
}
