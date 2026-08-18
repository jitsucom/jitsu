package main

import (
	certificatemanager "cloud.google.com/go/certificatemanager/apiv1"
	"context"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"google.golang.org/api/option"
	"net/http"
	"time"
)

type Context struct {
	config  *Config
	server  *http.Server
	certMgr *certificatemanager.Client
	manager *Manager
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}
	ctx := context.Background()
	a.certMgr, err = certificatemanager.NewClient(ctx, option.WithAuthCredentialsJSON(option.ServiceAccount, []byte(a.config.GoogleServiceAccountJson)))
	if err != nil {
		return err
	}

	a.manager = NewManager(a)

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
	_ = a.certMgr.Close()
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
