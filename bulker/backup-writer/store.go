// The spool lives on a single writer's retained persistent volume. SQLite's
// FULL synchronous WAL commit is the admission acknowledgement boundary.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

var errKeyConflict = errors.New("idempotency key was already used for different data")

func openSpool(path string) (*sql.DB, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	// SQLite derives WAL file permissions from the database file.
	f, err := os.OpenFile(absolute, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: absolute, RawQuery: "_journal_mode=WAL&_synchronous=FULL&_txlock=immediate&_busy_timeout=5000"}
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS spool (
        seq INTEGER PRIMARY KEY, workspace TEXT NOT NULL, request_id TEXT NOT NULL,
        digest BLOB NOT NULL, admitted INTEGER NOT NULL, payload BLOB,
        object TEXT, uploaded INTEGER, UNIQUE(workspace,request_id)
    );
    CREATE INDEX IF NOT EXISTS pending ON spool(workspace,seq) WHERE payload IS NOT NULL;
    CREATE INDEX IF NOT EXISTS receipts ON spool(uploaded) WHERE uploaded IS NOT NULL;`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func admit(ctx context.Context, db *sql.DB, workspace, key string, payload []byte) error {
	sum := sha256.Sum256(payload)
	result, err := db.ExecContext(ctx, `INSERT INTO spool(workspace,request_id,digest,admitted,payload)
        VALUES(?,?,?,?,?) ON CONFLICT(workspace,request_id) DO NOTHING`, workspace, key, sum[:], time.Now().Unix(), payload)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil || count == 1 {
		return err
	}
	var previous []byte
	if err = db.QueryRowContext(ctx, `SELECT digest FROM spool WHERE workspace=? AND request_id=?`, workspace, key).Scan(&previous); err != nil {
		return err
	}
	if !bytes.Equal(previous, sum[:]) {
		return errKeyConflict
	}
	return nil
}

// seal fixes the name and exact record range in a transaction before any
// network I/O. New admissions cannot change an object being retried.
func seal(ctx context.Context, db *sql.DB, workspace string) (string, []byte, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback()
	var name sql.NullString
	var admitted int64
	err = tx.QueryRowContext(ctx, `SELECT object, admitted FROM spool WHERE workspace=? AND payload IS NOT NULL ORDER BY seq LIMIT 1`, workspace).Scan(&name, &admitted)
	if err != nil {
		return "", nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT seq,payload FROM spool WHERE workspace=? AND object IS ? AND payload IS NOT NULL ORDER BY seq`, workspace, name)
	if err != nil {
		return "", nil, err
	}
	var data bytes.Buffer
	var last int64
	for rows.Next() {
		var seq int64
		var payload []byte
		if err = rows.Scan(&seq, &payload); err != nil {
			rows.Close()
			return "", nil, err
		}
		data.Write(payload)
		last = seq
		if !name.Valid && data.Len() >= 8<<20 {
			break
		}
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return "", nil, err
	}
	if err = rows.Close(); err != nil {
		return "", nil, err
	}
	if !name.Valid {
		t := time.Unix(admitted, 0).UTC()
		name.String = fmt.Sprintf("%s/backup_%s_%s.ndjson.gz", t.Format("2006-01-02"), t.Format("2006_01_02T15_04_05"), uuid.NewString())
		_, err = tx.ExecContext(ctx, `UPDATE spool SET object=? WHERE workspace=? AND seq<=? AND object IS NULL AND payload IS NOT NULL`, name.String, workspace, last)
		if err != nil {
			return "", nil, err
		}
	}
	return name.String, data.Bytes(), tx.Commit()
}
