package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"hash/crc32"
	"log"
	"time"

	"cloud.google.com/go/storage"
	"google.golang.org/api/googleapi"
)

type uploadObject func(ctx context.Context, workspace, name string, data []byte) error

func gcsUploader(client *storage.Client, prefix string) uploadObject {
	return func(ctx context.Context, workspace, name string, data []byte) error {
		var compressed bytes.Buffer
		gz := gzip.NewWriter(&compressed)
		if _, err := gz.Write(data); err != nil {
			return err
		}
		if err := gz.Close(); err != nil {
			return err
		}
		checksum := crc32.Checksum(compressed.Bytes(), crc32.MakeTable(crc32.Castagnoli))
		digest := fmt.Sprintf("%x", sha256.Sum256(data))
		obj := client.Bucket(prefix + workspace).Object(name)
		writeCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		w := obj.If(storage.Conditions{DoesNotExist: true}).NewWriter(writeCtx)
		w.ContentType = "application/gzip"
		w.Metadata = map[string]string{"ndjson-sha256": digest}
		w.CRC32C = checksum
		w.SendCRC32C = true
		_, err := w.Write(compressed.Bytes())
		if err != nil {
			cancel()
			_ = w.Close()
		} else {
			err = w.Close()
		}
		if err == nil {
			return nil
		}
		var apiErr *googleapi.Error
		if !errors.As(err, &apiErr) || apiErr.Code != 412 {
			return err
		}
		// The previous attempt may have committed remotely before we could
		// checkpoint. Verify the actual object before reclaiming local data.
		a, err := obj.Attrs(ctx)
		if err != nil {
			return err
		}
		if a.Metadata["ndjson-sha256"] != digest || a.CRC32C != checksum || a.Size != int64(compressed.Len()) {
			return fmt.Errorf("existing object %s has different content", name)
		}
		return nil
	}
}

func flush(ctx context.Context, db *sql.DB, workspace string, upload uploadObject) (bool, error) {
	name, data, err := seal(ctx, db, workspace)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if err = upload(ctx, workspace, name, data); err != nil {
		return false, err
	}
	n, err := complete(ctx, db, workspace, name)
	return n >= maxObjectRequests || len(data) >= targetObjectSize, err
}

func drain(ctx context.Context, db *sql.DB, upload uploadObject) error {
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT workspace FROM spool WHERE payload IS NOT NULL ORDER BY workspace`)
	if err != nil {
		return err
	}
	var workspaces []string
	for rows.Next() {
		var ws string
		if err = rows.Scan(&ws); err != nil {
			rows.Close()
			return err
		}
		workspaces = append(workspaces, ws)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err = rows.Close(); err != nil {
		return err
	}
	// Give every workspace a turn before draining another full object.
	for len(workspaces) > 0 && ctx.Err() == nil {
		next := workspaces[:0]
		for _, ws := range workspaces {
			uploadCtx, cancel := context.WithTimeout(ctx, time.Minute)
			full, err := flush(uploadCtx, db, ws, upload)
			cancel()
			if err != nil {
				log.Printf("archive upload for %s: %v", ws, err)
				continue
			}
			if full {
				next = append(next, ws)
			}
		}
		workspaces = next
	}
	// Pending requests stay deduplicated throughout any GCS outage.
	_, err = db.ExecContext(ctx, `DELETE FROM spool WHERE expires < ?`, time.Now().Unix())
	if err != nil {
		return err
	}
	// FULL auto-vacuum releases database pages. Truncate the WAL as well so
	// admission can observe the reclaimed filesystem headroom after an outage.
	_, err = db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
