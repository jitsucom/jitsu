package adapters

import (
	"database/sql"
	"fmt"
	"github.com/jitsucom/eventnative/server/logging"
)

//Transaction is sql transaction wrapper. Used for handling and log errors with db type (postgres, redshift, clickhouse or snowflake)
//on Commit() and Rollback() calls
//Use DirectCommit() if you need not to swallow an error on commit
type Transaction struct {
	dbType string
	tx     *sql.Tx
}

func (t *Transaction) Commit() {
	if err := t.tx.Commit(); err != nil {
		logging.SystemErrorf("Unable to commit %s transaction: %v", t.dbType, err)
	}
}

func (t *Transaction) DirectCommit() error {
	if err := t.tx.Commit(); err != nil {
		return fmt.Errorf("Unable to commit %s transaction: %v", t.dbType, err)
	}

	return nil
}

func (t *Transaction) Rollback() {
	if err := t.tx.Rollback(); err != nil {
		logging.SystemErrorf("Unable to rollback %s transaction: %v", t.dbType, err)
	}
}
