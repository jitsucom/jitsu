package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Context struct {
	config       *Config
	server       *http.Server
	pScript      appbase.Repository[[]byte]
	repositories *repositories
}

// repositories is a map that is safe for concurrent use. RepositoryHandler adds
// lazily discovered repositories from request goroutines while /health ranges
// over them, and Go aborts the process on a concurrent map read and write.
type repositories struct {
	mu     sync.RWMutex
	byName map[string]appbase.Repository[[]byte]
}

func newRepositories() *repositories {
	return &repositories{byName: map[string]appbase.Repository[[]byte]{}}
}

func (r *repositories) add(name string, rep appbase.Repository[[]byte]) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.byName[name] = rep
}

func (r *repositories) get(name string) (appbase.Repository[[]byte], bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	rep, ok := r.byName[name]
	return rep, ok
}

// addIfAbsent returns the repository registered under name afterwards, and
// whether rep was the one registered. Two requests for the same unknown
// repository each build their own; the loser must be closed rather than left
// refreshing forever against nothing.
func (r *repositories) addIfAbsent(name string, rep appbase.Repository[[]byte]) (appbase.Repository[[]byte], bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.byName[name]; ok {
		return existing, false
	}
	r.byName[name] = rep
	return rep, true
}

// snapshot copies the map so callers can range over it without holding the lock
// (and so /health reports one consistent view).
func (r *repositories) snapshot() map[string]appbase.Repository[[]byte] {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]appbase.Repository[[]byte], len(r.byName))
	for name, rep := range r.byName {
		out[name] = rep
	}
	return out
}

type RawRepositoryData struct {
	// validateJSON rejects payloads that are not complete, valid JSON. A repository
	// source that fails mid-stream can produce a truncated body with HTTP 200 —
	// without this check such payload gets cached and served to every consumer.
	validateJSON bool
	data         atomic.Pointer[[]byte]
}

func (r *RawRepositoryData) Init(reader io.Reader, tag any) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	if r.validateJSON && !json.Valid(data) {
		return fmt.Errorf("payload is not valid JSON (%d bytes) - keeping previous data", len(data))
	}
	r.data.Store(&data)
	return nil
}

func (r *RawRepositoryData) GetData() *[]byte {
	return r.data.Load()
}

func (r *RawRepositoryData) Store(writer io.Writer) error {
	_, err := writer.Write(*r.data.Load())
	return err
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}

	baseUrl := a.config.RepositoryBaseURL
	token := a.config.RepositoryAuthToken
	refreshPeriodSec := a.config.RepositoryRefreshPeriodSec
	cacheDir := a.config.CacheDir

	a.pScript = appbase.NewHTTPRepository[[]byte]("p.js", a.config.ScriptOrigin, "", appbase.HTTPTagETag, &RawRepositoryData{}, 5, 60, cacheDir, appbase.WaitForData)
	reps := a.config.Repositories
	a.repositories = newRepositories()
	a.repositories.add("p.js", a.pScript)
	for _, rep := range strings.Split(reps, ",") {
		a.repositories.add(rep, appbase.NewHTTPRepository[[]byte](rep, baseUrl+"/"+rep, token, appbase.HTTPTagLastModified, &RawRepositoryData{validateJSON: true}, 2, refreshPeriodSec, cacheDir, appbase.WaitForData))
	}
	router := NewRouter(a)
	a.server = &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", a.config.HTTPPort),
		Handler:           router.Engine(),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	return nil
}

func (a *Context) Cleanup() error {
	for _, rep := range a.repositories.snapshot() {
		_ = rep.Close()
	}
	return nil
}

func (a *Context) ShutdownSignal() error {
	_ = a.server.Shutdown(context.Background())
	return nil
}

func (a *Context) Server() *http.Server {
	return a.server
}

func (a *Context) Config() *Config {
	return a.config
}
