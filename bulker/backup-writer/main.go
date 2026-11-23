package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cloud.google.com/go/storage"
)

func run(ctx context.Context) error {
	path, prefix, token := os.Getenv("BACKUP_WRITER_SPOOL_DIR"), os.Getenv("BACKUP_WRITER_BUCKET_PREFIX"), os.Getenv("BACKUP_WRITER_TOKEN")
	if path == "" || prefix == "" || token == "" {
		return errors.New("set BACKUP_WRITER_SPOOL_DIR, BACKUP_WRITER_BUCKET_PREFIX and BACKUP_WRITER_TOKEN")
	}
	store, err := openSpool(path, prefix)
	if err != nil {
		return err
	}
	defer store.close()
	client, err := storage.NewClient(ctx)
	if err != nil {
		return err
	}
	defer client.Close()
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		upload := gcsUploader(client, prefix)
		for ctx.Err() == nil {
			if err := drain(ctx, store, upload); err != nil && ctx.Err() == nil {
				log.Printf("archive drain: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
	defer func() { cancel(); <-done }()
	addr := os.Getenv("BACKUP_WRITER_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	server := http.Server{Addr: addr, Handler: handler(store, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: time.Minute}
	result := make(chan error, 1)
	go func() { result <- server.ListenAndServe() }()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		shutdown, stop := context.WithTimeout(context.Background(), 10*time.Second)
		defer stop()
		return server.Shutdown(shutdown)
	}
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil {
		log.Fatal(err)
	}
}
