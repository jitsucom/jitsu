package adapters

import (
	"database/sql"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
)

//Transaction is sql transaction wrapper. Used for handling and log errors with db type (postgres, mySQL, redshift, clickhouse or snowflake)
//on Commit() and Rollback() calls
//Use DirectCommit() if you need not to swallow an error on commit
type Transaction struct {
	dbType string
	tx     *sql.Tx
}

//Commit finishes underlying transaction and logs system err if occurred
func (t *Transaction) Commit() {
	if err := t.tx.Commit(); err != nil {
		logging.SystemErrorf("Unable to commit %s transaction: %v", t.dbType, err)
	}
}

//DirectCommit commits underlying transaction and returns err if occurred
func (t *Transaction) DirectCommit() error {
	if err := t.tx.Commit(); err != nil {
		return fmt.Errorf("Unable to commit %s transaction: %v", t.dbType, err)
	}

	return nil
}

//Rollback cancels underlying transaction and logs system err if occurred
func (t *Transaction) Rollback() {
	if err := t.tx.Rollback(); err != nil {
		logging.SystemErrorf("Unable to rollback %s transaction: %v", t.dbType, err)
	}
}
