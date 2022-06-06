package adapters

import (
	"context"
	"database/sql"
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"regexp"
)

const CtxDestinationId = "CtxDestinationId"

var ErrTableNotExist = errors.New("table doesn't exist")

var notExistRegexp = regexp.MustCompile(`(?i)(not|doesn't)\sexist`)

//SQLAdapter is a manager for DWH tables
type SQLAdapter interface {
	Adapter
	GetTableSchema(tableName string) (*Table, error)
	CreateTable(schemaToCreate *Table) error
	PatchTableSchema(schemaToAdd *Table) error
	Truncate(tableName string) error
	Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error
	DropTable(table *Table) (err error)
	ReplaceTable(originalTable, replacementTable string, dropOldTable bool) error
}

//Adapter is an adapter for all destinations
type Adapter interface {
	io.Closer
	Insert(insertContext *InsertContext) error
}

type SqlParams struct {
	ctx         context.Context
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger
}

func (sp *SqlParams) commonTruncate(statement string) error {
	sp.queryLogger.LogDDL(statement)

	if _, err := sp.dataSource.ExecContext(sp.ctx, statement); err != nil {
		return mapError(err)
	}

	return nil
}

func mapError(err error) error {
	if notExistRegexp.MatchString(err.Error()) {
		return ErrTableNotExist
	}
	return err
}
