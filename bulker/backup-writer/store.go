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
	"math"
	"net/url"
	"os"
	"path/filepath"
	"syscall"
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
	uri := url.URL{Scheme: "file", Path: absolute, RawQuery: "_auto_vacuum=FULL&_journal_mode=WAL&_synchronous=FULL&_txlock=immediate&_busy_timeout=5000"}
	db, err := sql.Open("sqlite3", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS spool (
        seq INTEGER PRIMARY KEY, workspace TEXT NOT NULL, request_id TEXT NOT NULL,
        digest BLOB NOT NULL, admitted INTEGER NOT NULL, payload BLOB,
        expires INTEGER NOT NULL DEFAULT 9223372036854775807, UNIQUE(workspace,request_id)
    );
    CREATE TABLE IF NOT EXISTS sealed(workspace TEXT PRIMARY KEY, name TEXT NOT NULL, last_seq INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS pending ON spool(workspace,seq) WHERE payload IS NOT NULL;
    CREATE INDEX IF NOT EXISTS receipts ON spool(expires);`)
	if err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// Keep space for WAL/checkpoint writes during recovery. The limit includes
// headroom for the bounded set of admissions already in flight.
const spoolHeadroom = 256 << 20

func checkSpace(path string) error {
	var fs syscall.Statfs_t
	if err := syscall.Statfs(path, &fs); err != nil {
		return err
	}
	if uint64(fs.Bavail)*uint64(fs.Bsize) < spoolHeadroom {
		return errors.New("archive spool below free-space reserve")
	}
	return nil
}

func admit(ctx context.Context, db *sql.DB, workspace, key string, payload []byte, spaceErr error) error {
	sum := sha256.Sum256(payload)
	if spaceErr == nil {
		result, err := db.ExecContext(ctx, `INSERT INTO spool(workspace,request_id,digest,admitted,payload)
        VALUES(?,?,?,?,?) ON CONFLICT(workspace,request_id) DO NOTHING`, workspace, key, sum[:], time.Now().Unix(), payload)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil || count == 1 {
			return err
		}
	}
	var previous []byte
	if err := db.QueryRowContext(ctx, `SELECT digest FROM spool WHERE workspace=? AND request_id=?`, workspace, key).Scan(&previous); err != nil {
		if errors.Is(err, sql.ErrNoRows) && spaceErr != nil {
			return spaceErr
		}
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
	var name string
	var end int64
	err = tx.QueryRowContext(ctx, "SELECT name,last_seq FROM sealed WHERE workspace=?", workspace).Scan(&name, &end)
	if errors.Is(err, sql.ErrNoRows) {
		end = math.MaxInt64
	} else if err != nil {
		return "", nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT seq,admitted,payload FROM spool WHERE workspace=? AND payload IS NOT NULL AND seq<=? ORDER BY seq`, workspace, end)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	var data bytes.Buffer
	var firstTime time.Time
	var last int64
	for count := 1; rows.Next(); count++ {
		var admitted int64
		var payload []byte
		if err = rows.Scan(&last, &admitted, &payload); err != nil {
			return "", nil, err
		}
		if count == 1 {
			firstTime = time.Unix(admitted, 0).UTC()
		}
		data.Write(payload)
		if name == "" && (count == maxObjectRequests || data.Len() >= targetObjectSize) {
			break
		}
	}
	if err = rows.Err(); err != nil {
		return "", nil, err
	}
	if err = rows.Close(); err != nil {
		return "", nil, err
	}
	if data.Len() == 0 {
		return "", nil, sql.ErrNoRows
	}
	if name == "" {
		name = fmt.Sprintf("%s/backup_%s_%s.ndjson.gz", firstTime.Format("2006-01-02"), firstTime.Format("2006_01_02T15_04_05"), uuid.NewString())
		if _, err = tx.ExecContext(ctx, "INSERT INTO sealed VALUES(?,?,?)", workspace, name, last); err != nil {
			return "", nil, err
		}
	}
	return name, data.Bytes(), tx.Commit()
}

const maxObjectRequests = 2048
const targetObjectSize = 8 << 20

func complete(ctx context.Context, db *sql.DB, workspace, name string) (int64, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, `UPDATE spool SET expires=?,payload=NULL WHERE workspace=? AND payload IS NOT NULL
        AND seq<=(SELECT last_seq FROM sealed WHERE workspace=? AND name=?)`, time.Now().Add(24*time.Hour).Unix(), workspace, workspace, name)
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if _, err = tx.ExecContext(ctx, "DELETE FROM sealed WHERE workspace=? AND name=?", workspace, name); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}
