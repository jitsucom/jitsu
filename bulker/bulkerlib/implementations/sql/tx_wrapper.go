package sql

import (
	"context"
	"database/sql"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"io"
)

// TxWrapper is sql transaction wrapper. Used for handling and log errors with db type (postgres, mySQL, redshift or snowflake)
// on Commit() and Rollback() calls
type TxWrapper struct {
	dbType       string
	db           DB
	tx           *sql.Tx
	custom       io.Closer
	queryLogger  *logging.QueryLogger
	errorAdapter ErrorAdapter
	closeDb      bool
	error        error
	// savepoints whether the transaction can isolate failing statements, see runIsolated
	savepoints bool
}

type TxOrDB interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	PrepareContext(ctx context.Context, query string) (*sql.Stmt, error)
}

type DB interface {
	TxOrDB
	io.Closer
}

func NewTxWrapper(dbType string, tx *sql.Tx, queryLogger *logging.QueryLogger, errorAdapter ErrorAdapter, savepoints bool) *TxWrapper {
	return &TxWrapper{dbType: dbType, tx: tx, queryLogger: queryLogger, errorAdapter: errorAdapter, savepoints: savepoints}
}

func NewDbWrapper(dbType string, db DB, queryLogger *logging.QueryLogger, errorAdapter ErrorAdapter, closeDb bool) *TxWrapper {
	return &TxWrapper{dbType: dbType, db: db, queryLogger: queryLogger, errorAdapter: errorAdapter, closeDb: closeDb}
}

func NewDummyTxWrapper(dbType string) *TxWrapper {
	return &TxWrapper{dbType: dbType}
}

func NewCustomWrapper(dbType string, custom io.Closer, err error) *TxWrapper {
	return &TxWrapper{dbType: dbType, custom: custom, error: err, closeDb: true}
}

// savepointName is the savepoint taken before a statement that is allowed to fail.
// A single name is enough because the savepoint is always released before the next
// one is taken - on both paths, since rolling back to a savepoint does not destroy it.
const savepointName = "bulker_stmt"

// abortedTransactionSQLState is returned by every statement that follows a failed one
// in the same Postgres transaction: "current transaction is aborted, commands ignored
// until end of transaction block".
const abortedTransactionSQLState = "25P02"

func (t *TxWrapper) supportsSavepoints() bool {
	return t.tx != nil && t.savepoints
}

// runIsolated runs statements whose failure must not poison the enclosing transaction,
// so that the caller can recover on the same connection - e.g. re-read the table schema
// and patch again after losing an ALTER TABLE race.
//
// Where the database needs it, fn runs inside a savepoint that is rolled back if fn
// fails. Everywhere else fn just runs. Anything already applied by a failed fn is undone,
// which is what the caller wants anyway: it is about to re-read the real schema and redo
// the work from there.
//
// The whole block and not statement by statement, deliberately: each savepoint is a
// subtransaction on the destination, and Postgres degrades cluster-wide once a
// transaction holds more than 64 of them.
func runIsolated(ctx context.Context, txOrDb TxOrDB, fn func() error) error {
	tx, ok := txOrDb.(*TxWrapper)
	if !ok || !tx.supportsSavepoints() {
		return fn()
	}
	if _, err := tx.ExecContext(ctx, "SAVEPOINT "+savepointName); err != nil {
		return err
	}
	if err := fn(); err != nil {
		if _, rollbackErr := tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT "+savepointName); rollbackErr != nil {
			// the transaction stays aborted - nothing left to do but report the original error
			logging.Errorf("failed to rollback to savepoint: %v", rollbackErr)
			return err
		}
		// rolling back to a savepoint keeps it established, so it has to be released here
		// too - otherwise every failure leaves one behind for the rest of the transaction
		if _, releaseErr := tx.ExecContext(ctx, "RELEASE SAVEPOINT "+savepointName); releaseErr != nil {
			logging.Errorf("failed to release savepoint after rollback: %v", releaseErr)
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, "RELEASE SAVEPOINT "+savepointName); err != nil {
		// fn succeeded, so the savepoint was there a statement ago: releasing it can only
		// fail if the transaction itself is gone (connection dropped, context cancelled).
		// Report that here rather than let the caller run on and fail further away from
		// the cause.
		return err
	}
	return nil
}

func wrap[R any](ctx context.Context,
	t *TxWrapper, queryFunction func(tx TxOrDB, query string, args ...any) (R, error),
	query string, args ...any,
) (res R, err error) {
	tx := t.tx
	if tx == nil {
		if t.db == nil {
			err = fmt.Errorf("database connection is not initialized. Run Ping method to attempt reinit connection")
			return
		}
		res, err = queryFunction(t.db, query, args...)
	} else {
		res, err = queryFunction(tx, query, args...)
	}
	if t.errorAdapter != nil {
		err = t.errorAdapter(err)
	}
	if t.queryLogger != nil {
		t.queryLogger.LogQuery(query, err, args...)
	}
	return res, err
}

// ExecContext executes a query that doesn't return rows.
// For example: an INSERT and UPDATE.
func (t *TxWrapper) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	return wrap(ctx, t, func(tx TxOrDB, query string, args ...any) (sql.Result, error) {
		return tx.ExecContext(ctx, query, args...)
	}, query, args...)
}

// QueryContext executes a query that returns rows, typically a SELECT.
func (t *TxWrapper) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	return wrap(ctx, t, func(tx TxOrDB, query string, args ...any) (*sql.Rows, error) {
		return tx.QueryContext(ctx, query, args...)
	}, query, args...)
}

// QueryRowContext executes a query that is expected to return at most one row.
// QueryRowContext always returns a non-nil value. Errors are deferred until
// Row's Scan method is called.
// If the query selects no rows, the *Row's Scan will return ErrNoRows.
// Otherwise, the *Row's Scan scans the first selected row and discards
// the rest.
func (t *TxWrapper) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	row, _ := wrap(ctx, t, func(tx TxOrDB, query string, args ...any) (*sql.Row, error) {
		return tx.QueryRowContext(ctx, query, args...), nil
	}, query, args...)
	return row
}

func (t *TxWrapper) GetCustom() (io.Closer, error) {
	return t.custom, t.error
}

// PrepareContext creates a prepared statement for use within a transaction.
//
// The returned statement operates within the transaction and will be closed
// when the transaction has been committed or rolled back.
//
// To use an existing prepared statement on this transaction, see Tx.Stmt.
//
// The provided context will be used for the preparation of the context, not
// for the execution of the returned statement. The returned statement
// will run in the transaction context.
func (t *TxWrapper) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	return wrap(ctx, t, func(tx TxOrDB, query string, args ...any) (*sql.Stmt, error) {
		return tx.PrepareContext(ctx, query)
	}, query)
}

// Commit commits underlying transaction and returns err if occurred
func (t *TxWrapper) Commit() error {
	if t.closeDb {
		defer func() {
			if err := t.db.Close(); err != nil {
				logging.Errorf("failed to close db: %v", err)
			}
		}()
	}
	if t.tx != nil {
		if err := t.tx.Commit(); err != nil {
			if t.errorAdapter != nil {
				err = t.errorAdapter(err)
			}
			return errorj.CommitTransactionError.Wrap(err, "failed to commit transaction")
		}
	}

	return nil
}

// Rollback cancels underlying transaction and logs system err if occurred
func (t *TxWrapper) Rollback() error {
	if t.closeDb {
		if t.db != nil {
			defer func() {
				if err := t.db.Close(); err != nil {
					logging.Errorf("failed to close db: %v", err)
				}
			}()
		}
		if t.custom != nil {
			defer func() {
				if err := t.custom.Close(); err != nil {
					logging.Errorf("failed to close db: %v", err)
				}
			}()
		}
	}
	if t.tx != nil {
		if err := t.tx.Rollback(); err != nil {
			//TODO: uncomment?
			//if !(t.dbType == "MySQL" && (strings.HasSuffix(err.Error(), mysql.ErrInvalidConn.Error()) || strings.HasSuffix(err.Error(), "bad connection"))) {
			//	err = CheckErr(err)
			//	return errorj.RollbackTransactionError.Wrap(err, "failed to rollback transaction").
			//		WithProperty(errorj.SystemErrorFlag, true)
			//} else {
			if t.errorAdapter != nil {
				err = t.errorAdapter(err)
			}
			return errorj.RollbackTransactionError.Wrap(err, "failed to rollback transaction")
			//}
		}
	}
	return nil
}

type ConWithDB struct {
	db   *sql.DB
	con  *sql.Conn
	ping bool
}

func NewConWithDB(db *sql.DB, con *sql.Conn, testConnection bool) *ConWithDB {
	return &ConWithDB{db: db, con: con, ping: testConnection}
}

func (c *ConWithDB) ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error) {
	c.testConnection(ctx)
	return c.con.ExecContext(ctx, query, args...)
}

func (c *ConWithDB) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	c.testConnection(ctx)
	return c.con.QueryContext(ctx, query, args...)
}

func (c *ConWithDB) QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row {
	c.testConnection(ctx)
	return c.con.QueryRowContext(ctx, query, args...)
}

func (c *ConWithDB) PrepareContext(ctx context.Context, query string) (*sql.Stmt, error) {
	c.testConnection(ctx)
	return c.con.PrepareContext(ctx, query)
}

func (c *ConWithDB) testConnection(ctx context.Context) {
	if c.ping {
		currentCon := c.con
		if err := currentCon.PingContext(ctx); err != nil {
			newCon, err := c.db.Conn(ctx)
			if err == nil {
				c.con = newCon
				_ = currentCon.Close()
			}
		}
	}
}

func (c *ConWithDB) Conn(ctx context.Context) *sql.Conn {
	c.testConnection(ctx)
	return c.con
}

func (c *ConWithDB) Close() error {
	_ = c.con.Close()
	return nil
}
