package main

import (
	"context"
	"fmt"
	"io"
	"sort"
	"strings"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations"
	"github.com/jitsucom/bulker/bulkerlib/implementations/file_storage"
	bulkertypes "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
)

// The S3 and GCS batch writer names its object after the table and the second the writer started in, and adds a batch number
// only if the context of the commit carries one. A stream is committed at every checkpoint and opened again on the next
// record, so two writers of one table can start in the same second. The later upload then replaces the earlier object, its
// records are gone and the saved cursor has moved past them. These tests use a bucket that replaces an object when a key is
// uploaded again, like S3 and GCS do.

// overwritingBucket is a file adapter over a map: uploading to an existing key replaces the object.
type overwritingBucket struct {
	objects map[string][]byte
	uploads int
}

func (b *overwritingBucket) Close() error { return nil }
func (b *overwritingBucket) Type() string { return "s3" }
func (b *overwritingBucket) Ping() error  { return nil }
func (b *overwritingBucket) UploadBytes(name string, data []byte) error {
	b.uploads++
	b.objects[name] = data
	return nil
}
func (b *overwritingBucket) Upload(name string, r io.ReadSeeker) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	return b.UploadBytes(name, data)
}
func (b *overwritingBucket) GetObjectURL(string) (string, error)  { return "", nil }
func (b *overwritingBucket) Download(name string) ([]byte, error) { return b.objects[name], nil }
func (b *overwritingBucket) DeleteObject(key string) error        { delete(b.objects, key); return nil }
func (b *overwritingBucket) Path(name string) string              { return name }
func (b *overwritingBucket) AddFileExtension(name string) string  { return name + ".ndjson" }
func (b *overwritingBucket) Format() bulkertypes.FileFormat       { return bulkertypes.FileFormatNDJSON }
func (b *overwritingBucket) Compression() bulkertypes.FileCompression {
	return bulkertypes.FileCompressionNONE
}

func (b *overwritingBucket) keys() []string {
	keys := make([]string, 0, len(b.objects))
	for k := range b.objects {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// bucketDestination creates the same writers as the S3 and GCS destinations (see S3Bulker.CreateStream).
type bucketDestination struct {
	bulker.Bulker
	bucket implementations.FileAdapter
}

func (d bucketDestination) Type() string { return "s3" }
func (d bucketDestination) CreateStream(id, tableName string, mode bulker.BulkMode, opts ...bulker.StreamOption) (bulker.BulkerStream, error) {
	if mode == bulker.ReplaceTable {
		return file_storage.NewReplaceTableStream(id, d.bucket, tableName, opts...)
	}
	return file_storage.NewTransactionalStream(id, d.bucket, tableName, opts...)
}

// freezeClock makes every writer started in the test start in the same second.
func freezeClock(t *testing.T) {
	t.Helper()
	timestamp.FreezeTime()
	timestamp.SetFreezeTime(time.Date(2026, 11, 19, 7, 30, 0, 0, time.UTC))
	t.Cleanup(timestamp.UnfreezeTime)
}

// A stream committed again and again within one second keeps every batch. The first object keeps the name it always had.
func TestCommitsWithinOneSecondKeepEveryBatch(t *testing.T) {
	freezeClock(t)
	bucket := &overwritingBucket{objects: map[string][]byte{}}
	stream := NewActiveStream("orders", "incremental", bulker.Batch)
	for i := 1; i <= 3; i++ {
		writer, err := file_storage.NewTransactionalStream(fmt.Sprintf("w%d", i), bucket, "orders")
		if err != nil {
			t.Fatal(err)
		}
		if err := stream.Begin(writer); err != nil {
			t.Fatal(err)
		}
		row := jsonorder.NewOrderedMap[string, any](0)
		row.Set("id", fmt.Sprintf("row-%d", i))
		if err := stream.Consume(row, 10); err != nil {
			t.Fatal(err)
		}
		stream.Commit(false)
		if stream.Error != "" {
			t.Fatalf("commit %d failed: %s", i, stream.Error)
		}
	}
	want := []string{"orders_2026_11_19T07_30_00.ndjson", "orders_2026_11_19T07_30_00_1.ndjson", "orders_2026_11_19T07_30_00_2.ndjson"}
	if got := bucket.keys(); strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("%d uploads left the objects %v, want %v: a later batch replaced an earlier one", bucket.uploads, got, want)
	}
	for i, key := range want {
		if got := strings.TrimSpace(string(bucket.objects[key])); got != fmt.Sprintf(`{"id":"row-%d"}`, i+1) {
			t.Errorf("%s holds %s, want row-%d", key, got, i+1)
		}
	}
}

const batchKeySourceTaskDDL = `create table source_task (
  sync_id text not null, task_id text not null, package text not null, version text not null,
  started_at timestamptz(3) not null default now(), updated_at timestamptz(3) not null default now(),
  started_by jsonb, status text not null, description text, metrics jsonb, error text,
  constraint source_task_pkey primary key (task_id))`

const batchKeySourceStateDDL = `create table source_state (
  sync_id text not null, stream text not null, state jsonb not null,
  timestamp timestamptz(3) not null default now(),
  constraint source_state_pkey primary key (sync_id, stream))`

// The sidecar's own path: records arrive, a stream state commits them, the next record opens a new writer. The saved cursor
// must never be ahead of what is in the bucket. Real Postgres, skipped without docker or with -short.
func TestPerStreamCheckpointsWithinOneSecondKeepEveryBatch(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real postgres")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	freezeClock(t)
	dsn, _ := startPostgres(t)
	pool, err := pg.NewPGPool(dsn, pg.WithStatementTimeout(10*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	ctx := context.Background()
	for _, ddl := range []string{batchKeySourceTaskDDL, batchKeySourceStateDDL} {
		if _, err := pool.Exec(ctx, ddl); err != nil {
			t.Fatal(err)
		}
	}
	bucket := &overwritingBucket{objects: map[string][]byte{}}
	s := &ReadSideCar{
		AbstractSideCar:  &AbstractSideCar{logLevel: "FATAL", dbLogLevel: "FATAL", syncId: "sync", taskId: "task", packageName: "airbyte/source-test", packageVersion: "1", startedAt: time.Now(), dbpool: pool, eventsLogService: &eventslog.DummyEventsLogService{}},
		processedStreams: map[string]*ActiveStream{},
		catalog:          jsonorder.NewOrderedMap[string, *Stream](0),
		initialState:     "has saved state", // incremental streams with saved state are written in batch mode
	}
	s.blk = bucketDestination{bucket: bucket}
	s.catalog.Set("orders", &Stream{StreamMeta: &StreamMeta{Name: "orders", JSONSchema: StreamJsonSchema{Properties: jsonorder.NewOrderedMap[string, any](0)}}, SyncMode: "incremental"})
	for _, cursor := range []string{"c1", "c2", "c3"} {
		stream, err := s.openStream("orders")
		if err != nil {
			t.Fatal(err)
		}
		row := jsonorder.NewOrderedMap[string, any](0)
		row.Set("id", "row-"+cursor)
		if err := stream.Consume(row, 10); err != nil {
			t.Fatal(err)
		}
		stream.unsavedState = map[string]any{"cursor": cursor}
		s.checkpointIfNecessary(stream) // what a STREAM state message does
		if stream.Error != "" {
			t.Fatalf("commit for %s failed: %s", cursor, stream.Error)
		}
	}
	var saved string
	if err := pool.QueryRow(ctx, "select state->>'cursor' from source_state where sync_id = 'sync' and stream = 'orders'").Scan(&saved); err != nil {
		t.Fatalf("could not read the saved cursor: %v", err)
	}
	if saved != "c3" {
		t.Fatalf("saved cursor %q, want c3", saved)
	}
	if len(bucket.objects) != 3 {
		t.Fatalf("the cursor is c3 but the bucket holds %d object(s) %v after %d uploads, want 3: batches were replaced and the cursor moved past them", len(bucket.objects), bucket.keys(), bucket.uploads)
	}
}
