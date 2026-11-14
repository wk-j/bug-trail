// Package server runs the Bug Trail dashboard: static UI, a JSON API over the
// trails folder, and server-sent events when a trail file changes.
package server

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wk-j/bug-trail/internal/format"
)

var idRE = regexp.MustCompile(`^[\w.-]+$`)

// MaxUpload caps the size of an uploaded trail.
const MaxUpload = 5 << 20

type Server struct {
	Dir string
	Web fs.FS // contents of web/: index.html, app.js, style.css
	// Token enables PUT/DELETE /api/trails/{id} for clients that send
	// "Authorization: Bearer <Token>". Empty means the API is read-only.
	Token string

	mu      sync.Mutex
	clients map[chan string]struct{}
}

type trailResponse struct {
	ID         string        `json:"id"`
	Trail      any           `json:"trail"`
	Validation format.Result `json:"validation"`
	Mtime      string        `json:"mtime,omitempty"`
}

type trailSummary struct {
	ID         string `json:"id"`
	Mtime      string `json:"mtime"`
	Issue      any    `json:"issue"`
	Summary    any    `json:"summary"`
	AnalyzedAt any    `json:"analyzed_at"`
	Nodes      int    `json:"nodes"`
	Errors     int    `json:"errors"`
}

func (s *Server) readTrail(id string) (trailResponse, error) {
	file := filepath.Join(s.Dir, id+".json")
	raw, err := os.ReadFile(file)
	if err != nil {
		return trailResponse{}, err
	}
	trail, res := format.ValidateJSON(raw)
	out := trailResponse{ID: id, Trail: trail, Validation: res}
	if st, err := os.Stat(file); err == nil {
		out.Mtime = st.ModTime().UTC().Format(time.RFC3339)
	}
	return out, nil
}

func (s *Server) listTrails() []trailSummary {
	entries, _ := os.ReadDir(s.Dir)
	out := []trailSummary{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !strings.HasSuffix(name, ".json") || !idRE.MatchString(name) {
			continue
		}
		t, err := s.readTrail(strings.TrimSuffix(name, ".json"))
		if err != nil {
			continue
		}
		sum := trailSummary{ID: t.ID, Mtime: t.Mtime, Errors: len(t.Validation.Errors)}
		if m, ok := t.Trail.(map[string]any); ok {
			sum.Issue, sum.Summary, sum.AnalyzedAt = m["issue"], m["summary"], m["analyzed_at"]
			if n, ok := m["nodes"].([]any); ok {
				sum.Nodes = len(n)
			}
		}
		out = append(out, sum)
	}
	key := func(t trailSummary) string {
		if a, ok := t.AnalyzedAt.(string); ok {
			return a
		}
		return t.Mtime
	}
	sort.SliceStable(out, func(i, j int) bool { return key(out[i]) > key(out[j]) })
	return out
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	static := func(name, ctype string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			b, err := fs.ReadFile(s.Web, name)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", ctype)
			w.Header().Set("Cache-Control", "no-store")
			_, _ = w.Write(b)
		}
	}
	mux.HandleFunc("GET /{$}", static("index.html", "text/html; charset=utf-8"))
	mux.HandleFunc("GET /app.js", static("app.js", "text/javascript; charset=utf-8"))
	mux.HandleFunc("GET /style.css", static("style.css", "text/css; charset=utf-8"))
	mux.HandleFunc("GET /format.js", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		_, _ = w.Write(format.BrowserModule())
	})
	mux.HandleFunc("GET /api/trails", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"dir": s.Dir, "trails": s.listTrails()})
	})
	mux.HandleFunc("GET /api/trails/{id}", func(w http.ResponseWriter, r *http.Request) {
		id := r.PathValue("id")
		if !idRE.MatchString(id) {
			writeJSON(w, 404, map[string]string{"error": fmt.Sprintf("No trail %q in %s", id, s.Dir)})
			return
		}
		t, err := s.readTrail(id)
		if err != nil {
			writeJSON(w, 404, map[string]string{"error": fmt.Sprintf("No trail %q in %s", id, s.Dir)})
			return
		}
		writeJSON(w, 200, t)
	})
	mux.HandleFunc("PUT /api/trails/{id}", s.authorized(s.putTrail))
	mux.HandleFunc("DELETE /api/trails/{id}", s.authorized(s.deleteTrail))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(s.Dir); err != nil {
			writeJSON(w, 503, map[string]string{"status": "trails folder missing"})
			return
		}
		writeJSON(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /events", s.events)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 404, map[string]string{"error": "Not found"})
	})
	return mux
}

func (s *Server) authorized(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.Token == "" {
			writeJSON(w, 403, map[string]string{"error": "uploads are disabled: start the server with BUG_TRAIL_TOKEN set"})
			return
		}
		got, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || subtle.ConstantTimeCompare([]byte(got), []byte(s.Token)) != 1 {
			w.Header().Set("WWW-Authenticate", `Bearer realm="bug-trail"`)
			writeJSON(w, 401, map[string]string{"error": "missing or wrong token"})
			return
		}
		id := r.PathValue("id")
		if !idRE.MatchString(id) {
			writeJSON(w, 400, map[string]string{"error": "trail id may only contain letters, digits, '_', '-' and '.'"})
			return
		}
		next(w, r)
	}
}

// putTrail stores a trail after validating it. Files with format errors are
// rejected so the dashboard only ever shows trails that render.
func (s *Server) putTrail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxUpload))
	if err != nil {
		writeJSON(w, 413, map[string]string{"error": fmt.Sprintf("trail is larger than %d bytes", MaxUpload)})
		return
	}
	_, res := format.ValidateJSON(raw)
	if len(res.Errors) > 0 {
		writeJSON(w, 422, map[string]any{"error": "trail has format errors", "validation": res})
		return
	}
	file := filepath.Join(s.Dir, id+".json")
	_, existed := os.Stat(file)
	// Write to a temp file and rename, so readers never see half a file.
	tmp, err := os.CreateTemp(s.Dir, ".upload-*")
	if err == nil {
		_, err = tmp.Write(raw)
		if cerr := tmp.Close(); err == nil {
			err = cerr
		}
		if err == nil {
			err = os.Rename(tmp.Name(), file)
		}
		if err != nil {
			_ = os.Remove(tmp.Name())
		}
	}
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	status := 200
	if existed != nil {
		status = 201
	}
	writeJSON(w, status, map[string]any{"id": id, "url": "/#/t/" + id, "validation": res})
}

func (s *Server) deleteTrail(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if err := os.Remove(filepath.Join(s.Dir, id+".json")); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			writeJSON(w, 404, map[string]string{"error": fmt.Sprintf("No trail %q", id)})
			return
		}
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(204)
}

func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // let nginx-style proxies stream events
	_, _ = fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ch := make(chan string, 16)
	s.mu.Lock()
	s.clients[ch] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.clients, ch)
		s.mu.Unlock()
	}()

	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case id := <-ch:
			b, _ := json.Marshal(map[string]string{"id": id})
			_, _ = fmt.Fprintf(w, "data: %s\n\n", b)
		case <-ping.C:
			_, _ = fmt.Fprint(w, ": ping\n\n")
		}
		flusher.Flush()
	}
}

func (s *Server) broadcast(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for ch := range s.clients {
		select {
		case ch <- id:
		default: // slow client; it will catch up on the next change
		}
	}
}

// watch polls the trails folder and broadcasts the ids of changed files.
// Polling keeps the binary dependency-free and works on every OS.
func (s *Server) watch(ctx context.Context) {
	type stamp struct {
		mod  time.Time
		size int64
	}
	scan := func() map[string]stamp {
		m := map[string]stamp{}
		entries, _ := os.ReadDir(s.Dir)
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			if info, err := e.Info(); err == nil {
				m[strings.TrimSuffix(e.Name(), ".json")] = stamp{info.ModTime(), info.Size()}
			}
		}
		return m
	}
	prev := scan()
	tick := time.NewTicker(400 * time.Millisecond)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		cur := scan()
		for id, st := range cur {
			if old, ok := prev[id]; !ok || old != st {
				s.broadcast(id)
			}
		}
		for id := range prev {
			if _, ok := cur[id]; !ok {
				s.broadcast(id)
			}
		}
		prev = cur
	}
}

// ListenAndServe starts the dashboard. It returns once the port is bound
// (ready is called) and blocks until ctx is cancelled.
func (s *Server) ListenAndServe(ctx context.Context, addr string, ready func()) error {
	if err := os.MkdirAll(s.Dir, 0o755); err != nil {
		return err
	}
	s.clients = map[chan string]struct{}{}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	srv := &http.Server{
		Handler:           s.handler(),
		ReadHeaderTimeout: 10 * time.Second,
		// Request contexts end with ctx, so open event streams close on shutdown.
		BaseContext: func(net.Listener) context.Context { return ctx },
	}
	go s.watch(ctx)
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	if ready != nil {
		ready()
	}
	if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
