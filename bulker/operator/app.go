package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

type Context struct {
	config   *Config
	server   *http.Server
	operator *Operator
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}

	a.operator, err = NewOperator(a)
	if err != nil {
		return err
	}

	router := NewRouter(a)
	a.server = &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", a.config.HTTPPort),
		Handler:           router.Engine(),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}

	// Start operator in background
	go a.operator.Start()

	return nil
}

func (a *Context) Cleanup() error {
	if a.operator != nil {
		_ = a.operator.Close()
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

func (a *Context) Operator() *Operator {
	return a.operator
}
