package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

type Context struct {
	config       *Config
	server       *http.Server
	pScript      appbase.Repository[[]byte]
	repositories map[string]appbase.Repository[[]byte]
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
	for _, rep := range strings.Split(reps, ",") {
		a.repositories[rep] = appbase.NewHTTPRepository[[]byte](rep, baseUrl+"/"+rep, token, appbase.HTTPTagLastModified, &RawRepositoryData{validateJSON: true}, 2, refreshPeriodSec, cacheDir)

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
	for _, rep := range a.repositories {
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
