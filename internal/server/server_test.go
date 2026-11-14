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
	s := &Server{Dir: dir, Web: fstest.MapFS{"index.html": {Data: []byte("<html>")}}, clients: map[chan string]struct{}{}}
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
