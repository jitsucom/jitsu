package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/pg"
)

type Context struct {
	config              *Config
	dbpool              *pgxpool.Pool
	k8sClient           *K8sJobClient
	server              *http.Server
	reprocessingManager *ReprocessingJobManager
}

func (a *Context) InitContext(settings *appbase.AppSettings) error {
	var err error
	a.config = &Config{}
	err = appbase.InitAppConfig(a.config, settings)
	if err != nil {
		return err
	}

	// Initialize database pool if DATABASE_URL is provided
	if a.config.DatabaseURL != "" {
		a.dbpool, err = pg.NewPGPool(a.config.DatabaseURL)
		if err != nil {
			return fmt.Errorf("failed to create postgres connection pool: %w", err)
		}

		// Initialize database schema
		err = InitReprocessingDBSchema(a.dbpool)
		if err != nil {
			return fmt.Errorf("failed to initialize database schema: %w", err)
		}
	}

	// Initialize K8s client if enabled
	if a.dbpool != nil {
		a.k8sClient, err = NewK8sJobClient(a.config)
		if err != nil {
			return fmt.Errorf("failed to initialize k8s client: %w", err)
		}
	}

	//// Initialize reprocessing manager
	//a.reprocessingManager, err = NewReprocessingJobManager(a.config, a.dbpool, a.k8sClient)
	//if err != nil {
	//	return fmt.Errorf("failed to initialize reprocessing manager: %w", err)
	//}
	//
	//// Initialize HTTP server with router
	//router := NewRouter(a)
	//a.server = &http.Server{
	//	Addr:              fmt.Sprintf("0.0.0.0:%d", a.config.HTTPPort),
	//	Handler:           router.Engine(),
	//	ReadTimeout:       time.Second * 5,
	//	ReadHeaderTimeout: time.Second * 5,
	//	IdleTimeout:       time.Second * 65,
	//}
	//
	//dlp, err := NewDeadLetterReprocessor(a.config)
	//if err != nil {
	//	return fmt.Errorf("failed to initialize dead letter reprocessor: %w", err)
	//}
	//dlpCfg := DeadLetterReprocessorConfig{
	//	DryRun:      false,
	//	TargetTopic: a.config.KafkaDestinationsTopicName,
	//	ActorId:     "cmgjhbphr0001l1041lyiw9zs-thz4-2uyg-ZWI97I",
	//}
	//cnt, err := dlp.CountRecords(context.Background(), dlpCfg)
	//if err != nil {
	//	return fmt.Errorf("failed to count dead letter records: %w", err)
	//}
	//fmt.Printf("Found %d records to reprocess\n", cnt)
	//res, err := dlp.Reprocess(context.Background(), dlpCfg)
	//if err != nil {
	//	return fmt.Errorf("failed to reprocess dead letter records: %w", err)
	//}
	//fmt.Printf("Reprocessing result: %+v\n", res)
	//
	//err = dlp.Close()
	//if err != nil {
	//	return fmt.Errorf("failed to close dead letter reprocessor: %w", err)
	//}

	return nil
}

func (a *Context) Cleanup() error {
	// Close reprocessing manager first to cancel running jobs and log final status
	if a.reprocessingManager != nil {
		_ = a.reprocessingManager.Close()
	}

	// Close database pool
	if a.dbpool != nil {
		a.dbpool.Close()
	}

	// Shutdown HTTP server
	if a.server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = a.server.Shutdown(ctx)
	}

	return nil
}

func (a *Context) ShutdownSignal() error {
	a.server.SetKeepAlivesEnabled(false)
	_ = a.server.Shutdown(context.Background())
	return nil
}

func (a *Context) Server() *http.Server {
	return a.server
}

func (a *Context) Config() *Config {
	return a.config
}
