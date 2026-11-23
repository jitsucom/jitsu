package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cloud.google.com/go/storage"
)

func run(ctx context.Context) error {
	path, prefix, token := os.Getenv("BACKUP_WRITER_DB"), os.Getenv("BACKUP_WRITER_BUCKET_PREFIX"), os.Getenv("BACKUP_WRITER_TOKEN")
	if path == "" || prefix == "" || token == "" {
		return errors.New("set BACKUP_WRITER_DB, BACKUP_WRITER_BUCKET_PREFIX and BACKUP_WRITER_TOKEN")
	}
	db, err := openSpool(path)
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TABLE IF NOT EXISTS destination (id INTEGER PRIMARY KEY CHECK(id=1),prefix TEXT NOT NULL);
        INSERT INTO destination(id,prefix) VALUES(1,?) ON CONFLICT DO NOTHING`, prefix); err != nil {
		return err
	}
	var saved string
	if err = db.QueryRow("SELECT prefix FROM destination WHERE id=1").Scan(&saved); err != nil {
		return err
	}
	if saved != prefix {
		return fmt.Errorf("spool belongs to bucket prefix %q", saved)
	}
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
			if err := drain(ctx, db, upload); err != nil && ctx.Err() == nil {
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
	server := http.Server{Addr: addr, Handler: handler(db, token), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 35 * time.Second, IdleTimeout: time.Minute}
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
