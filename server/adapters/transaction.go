package adapters

import (
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/jitsucom/jitsu/server/errorj"
	"strings"
)

//Transaction is sql transaction wrapper. Used for handling and log errors with db type (postgres, mySQL, redshift or snowflake)
//on Commit() and Rollback() calls
type Transaction struct {
	dbType string
	tx     *sql.Tx
}

//Commit commits underlying transaction and returns err if occurred
func (t *Transaction) Commit() error {
	if err := t.tx.Commit(); err != nil {
		err = checkErr(err)
		return errorj.CommitTransactionError.Wrap(err, "failed to commit transaction")
	}

	return nil
}

//Rollback cancels underlying transaction and logs system err if occurred
func (t *Transaction) Rollback() error {
	if err := t.tx.Rollback(); err != nil {
		if !(t.dbType == "MySQL" && (strings.HasSuffix(err.Error(), mysql.ErrInvalidConn.Error()) || strings.HasSuffix(err.Error(), "bad connection"))) {
			err = checkErr(err)
			return errorj.RollbackTransactionError.Wrap(err, "failed to rollback transaction").
				WithProperty(errorj.SystemErrorFlag, true)
		} else {
			err = checkErr(err)
			return errorj.RollbackTransactionError.Wrap(err, "failed to rollback transaction")
		}
	}

	return nil
}
