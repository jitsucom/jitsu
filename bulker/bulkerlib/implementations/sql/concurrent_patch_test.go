package sql

import (
	"context"
	"testing"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/stretchr/testify/require"
)

// TestConcurrentAddColumn covers JITSU-157.
//
// Several bulker instances can write to the same destination table, each keeping its
// own cached view of that table's schema. When a new property shows up in the data
// they all race to ALTER TABLE ADD COLUMN it, and the losers get "column already
// exists" (42701). Bulker recovers from that by re-reading the schema from the db and
// patching again - but on Postgres the failed ALTER aborts the whole transaction, so
// the recovery query itself used to fail with 25P02 and take the entire batch with it.
//
// The race is reproduced here without concurrency. A batch stream reads the table
// schema when it starts and patches it when it commits, so it works off a stale schema
// for as long as the batch lasts - all it takes is another instance adding the column
// in that window.
func TestConcurrentAddColumn(t *testing.T) {
	t.Parallel()
	testConfig, ok := configRegistry[PostgresBulkerTypeId]
	if !ok {
		t.Skipf("%s config is not available", PostgresBulkerTypeId)
	}
	config := bulker.Config{Id: PostgresBulkerTypeId, BulkerType: testConfig.BulkerType, DestinationConfig: testConfig.Config, LogLevel: bulker.Verbose}
	tableName := "concurrent_add_column_test"
	ctx := context.Background()
	reqr := require.New(t)

	// two independent instances of the same destination - as two bulker pods would be
	first, err := bulker.CreateBulker(config)
	reqr.NoError(err)
	defer func() { _ = first.Close() }()
	second, err := bulker.CreateBulker(config)
	reqr.NoError(err)
	defer func() { _ = second.Close() }()

	sqlAdapter := first.(SQLAdapter)
	namespace := sqlAdapter.DefaultNamespace()
	reqr.NoError(sqlAdapter.InitDatabase(ctx))
	_ = sqlAdapter.DropTable(ctx, namespace, tableName, true)
	defer func() { _ = sqlAdapter.DropTable(ctx, namespace, tableName, true) }()

	pushBatch := func(t *testing.T, blk bulker.Bulker, event string) error {
		stream, err := blk.CreateStream(tableName, tableName, bulker.Batch)
		if err != nil {
			return err
		}
		if _, _, err = stream.ConsumeJSON(ctx, []byte(event)); err != nil {
			_ = stream.Abort(ctx)
			return err
		}
		_, err = stream.Complete(ctx)
		return err
	}

	// the table starts out with a single property
	reqr.NoError(pushBatch(t, first, `{"id":1,"a":"one"}`))

	// the second instance opens a batch that introduces a new property. it reads the
	// table schema now - without that property - and holds it until it commits
	loser, err := second.CreateStream(tableName, tableName, bulker.Batch)
	reqr.NoError(err)
	defer func() { _ = loser.Abort(ctx) }()
	_, _, err = loser.ConsumeJSON(ctx, []byte(`{"id":2,"a":"two","b":"new"}`))
	reqr.NoError(err)

	// meanwhile the first instance adds the very same column and commits
	reqr.NoError(pushBatch(t, first, `{"id":3,"a":"three","b":"new"}`))

	// so this commit patches the table against a schema that is already stale: its
	// ALTER TABLE ADD COLUMN "b" fails with "column already exists" (42701)
	_, err = loser.Complete(ctx)
	reqr.NoError(err, "losing the ADD COLUMN race must not fail the batch")

	rows, err := sqlAdapter.Select(ctx, namespace, tableName, nil, []string{"id"})
	reqr.NoError(err)
	reqr.Len(rows, 3, "every batch must have landed: %+v", rows)
	for _, row := range rows {
		// the losing instance must not have dropped the new column on the floor
		reqr.Contains(row, "b")
	}
	reqr.Equal("new", rows[1]["b"])
}

// TestSavepointsAreOptedIn pins which adapters isolate statements with savepoints.
// It deliberately can't be derived from the type id: Redshift is built on top of the
// Postgres adapter and keeps its typeId, but Redshift has no SAVEPOINT - a Redshift
// destination taking one would fail every schema patch.
func TestSavepointsAreOptedIn(t *testing.T) {
	t.Parallel()
	testConfig, ok := configRegistry[PostgresBulkerTypeId]
	if !ok {
		t.Skipf("%s config is not available", PostgresBulkerTypeId)
	}
	pgConfig := testConfig.Config.(PostgresConfig)
	ctx := context.Background()

	postgres, err := bulker.CreateBulker(bulker.Config{Id: PostgresBulkerTypeId, BulkerType: PostgresBulkerTypeId, DestinationConfig: pgConfig})
	require.NoError(t, err)
	defer func() { _ = postgres.Close() }()
	tx, err := postgres.(SQLAdapter).OpenTx(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	require.True(t, tx.tx.supportsSavepoints(), "postgres transactions must isolate failing statements")

	// the redshift wire protocol is postgres, so the container is enough to build one
	redshift, err := NewRedshiftClassic(bulker.Config{Id: RedshiftBulkerTypeId, BulkerType: RedshiftBulkerTypeId, DestinationConfig: map[string]any{
		"host": pgConfig.Host, "port": pgConfig.Port, "database": pgConfig.Db, "defaultSchema": pgConfig.Schema,
		"username": pgConfig.Username, "password": pgConfig.Password, "parameters": pgConfig.Parameters,
		"bucket": "test", "region": "us-east-1", "accessKeyId": "test", "secretAccessKey": "test",
	}})
	require.NoError(t, err)
	defer func() { _ = redshift.Close() }()
	require.False(t, redshift.(*Redshift).supportsSavepoints,
		"Redshift inherits the Postgres adapter but has no SAVEPOINT - it must never take one")
	redshiftTx, err := redshift.(SQLAdapter).OpenTx(ctx)
	require.NoError(t, err)
	defer func() { _ = redshiftTx.Rollback() }()
	require.False(t, redshiftTx.tx.supportsSavepoints())
}

// TestExecIsolated pins the property the recovery above relies on: a statement that
// fails inside a transaction must leave that transaction usable.
func TestExecIsolated(t *testing.T) {
	t.Parallel()
	testConfig, ok := configRegistry[PostgresBulkerTypeId]
	if !ok {
		t.Skipf("%s config is not available", PostgresBulkerTypeId)
	}
	config := bulker.Config{Id: PostgresBulkerTypeId, BulkerType: testConfig.BulkerType, DestinationConfig: testConfig.Config, LogLevel: bulker.Verbose}
	ctx := context.Background()
	blk, err := bulker.CreateBulker(config)
	require.NoError(t, err)
	defer func() { _ = blk.Close() }()
	sqlAdapter := blk.(SQLAdapter)
	require.NoError(t, sqlAdapter.InitDatabase(ctx))

	const failing = `ALTER TABLE "no_such_table_jitsu157" ADD COLUMN c text`

	t.Run("savepoint keeps the transaction usable", func(t *testing.T) {
		tx, err := sqlAdapter.OpenTx(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback() }()
		require.True(t, tx.tx.supportsSavepoints(), "postgres transactions must support savepoints")

		require.Error(t, execIsolated(ctx, tx.tx, failing))
		require.NoError(t, execIsolated(ctx, tx.tx, "SELECT 1"), "transaction must still be usable after an isolated failure")
	})

	t.Run("a failed statement leaves no savepoint behind", func(t *testing.T) {
		// rolling back to a savepoint keeps it established, so failures would otherwise
		// stack one savepoint per attempt for the rest of the transaction
		tx, err := sqlAdapter.OpenTx(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback() }()

		require.Error(t, execIsolated(ctx, tx.tx, failing))
		_, err = tx.tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+savepointName)
		// 3B001 invalid_savepoint_specification - there is nothing left to roll back to
		require.ErrorContains(t, err, "3B001")
	})

	t.Run("without isolation the transaction is aborted", func(t *testing.T) {
		// documents why the savepoint is needed: this is what every statement after a
		// failed one looked like in production - 25P02, hiding the actual error
		tx, err := sqlAdapter.OpenTx(ctx)
		require.NoError(t, err)
		defer func() { _ = tx.Rollback() }()

		_, err = tx.tx.ExecContext(ctx, failing)
		require.Error(t, err)
		_, err = tx.tx.ExecContext(ctx, "SELECT 1")
		require.ErrorContains(t, err, abortedTransactionSQLState)
	})
}
