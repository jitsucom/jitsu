package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type Context struct {
	config  *Config
	server  *http.Server
	pScript appbase.Repository[[]byte]
	// mu guards repositories and breakers: both are written by lazy
	// initialization in RepositoryHandler while other handlers read them
	mu           sync.RWMutex
	repositories map[string]appbase.Repository[[]byte]
	breakers     map[string]*BreakerRepositoryData
}

func (a *Context) getRepository(name string) (appbase.Repository[[]byte], bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	rep, ok := a.repositories[name]
	return rep, ok
}

func (a *Context) getBreaker(name string) (*BreakerRepositoryData, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	breaker, ok := a.breakers[name]
	return breaker, ok
}

func (a *Context) repositorySnapshot() map[string]appbase.Repository[[]byte] {
	a.mu.RLock()
	defer a.mu.RUnlock()
	snapshot := make(map[string]appbase.Repository[[]byte], len(a.repositories))
	for name, rep := range a.repositories {
		snapshot[name] = rep
	}
	return snapshot
}

// registerRepository stores a lazily initialized repository (and its breaker,
// if guarded) so /health and the breaker accept endpoint cover it. When a
// concurrent handler already registered the same name, the incoming duplicate
// is closed and the canonical instance is returned.
func (a *Context) registerRepository(name string, repository appbase.Repository[[]byte], breaker *BreakerRepositoryData) appbase.Repository[[]byte] {
	a.mu.Lock()
	existing, ok := a.repositories[name]
	if !ok {
		a.repositories[name] = repository
		if breaker != nil {
			a.breakers[name] = breaker
		}
	}
	a.mu.Unlock()
	if ok {
		_ = repository.Close()
		return existing
	}
	return repository
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

	a.pScript = appbase.NewHTTPRepository[[]byte]("p.js", a.config.ScriptOrigin, "", appbase.HTTPTagETag, &RawRepositoryData{}, 5, 60, cacheDir)
	reps := a.config.Repositories
	a.repositories = map[string]appbase.Repository[[]byte]{
		"p.js": a.pScript,
	}
	a.breakers = map[string]*BreakerRepositoryData{}
	breakerRepos := map[string]bool{}
	if a.config.BreakerEnabled {
		configured := map[string]bool{}
		for _, rep := range strings.Split(reps, ",") {
			configured[strings.TrimSpace(rep)] = true
		}
		for _, rep := range strings.Split(a.config.BreakerRepositories, ",") {
			rep = strings.TrimSpace(rep)
			breakerRepos[rep] = true
			if !configured[rep] {
				// a misspelled entry must not silently leave a repo unguarded
				logging.Warnf("[cfgkpr] BREAKER_REPOSITORIES entry %q is not in REPOSITORIES — no such repository is served statically", rep)
			}
		}
	}
	for _, rep := range strings.Split(reps, ",") {
		// trimmed so a spaced REPOSITORIES list can't silently unguard a repo
		// (breakerRepos keys are trimmed too)
		rep = strings.TrimSpace(rep)
		// the breaker's row-level parse subsumes validateJSON for guarded repos
		var data appbase.RepositoryData[[]byte] = &RawRepositoryData{validateJSON: true}
		if breakerRepos[rep] {
			breaker := NewBreakerRepositoryData(rep, BreakerConfig{
				MaxChangePercent: a.config.BreakerMaxChangePercent,
				MaxRemovePercent: a.config.BreakerMaxRemovePercent,
				MinChangedRows:   a.config.BreakerMinChangedRows,
			}, cacheDir)
			a.breakers[rep] = breaker
			data = breaker
		}
		a.repositories[rep] = appbase.NewHTTPRepository[[]byte](rep, baseUrl+"/"+rep, token, appbase.HTTPTagLastModified, data, 2, refreshPeriodSec, cacheDir)

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
	for _, rep := range a.repositorySnapshot() {
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
