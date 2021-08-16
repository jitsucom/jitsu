package adapters

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"regexp"
)

var ErrTableNotExist = errors.New("table doesn't exist")

var notExistRegexp = regexp.MustCompile(`(?i)(not|doesn't)\sexist`)

//SQLAdapter is a manager for DWH tables
type SQLAdapter interface {
	Adapter
	GetTableSchema(tableName string) (*Table, error)
	CreateTable(schemaToCreate *Table) error
	PatchTableSchema(schemaToAdd *Table) error
	BulkInsert(table *Table, objects []map[string]interface{}) error
	BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error
	Truncate(tableName string) error
}

//Adapter is an adapter for all destinations
type Adapter interface {
	io.Closer
	Insert(eventContext *EventContext) error
}

type SqlParams struct {
	ctx         context.Context
	dataSource  *sql.DB
	queryLogger *logging.QueryLogger
}

func (sp *SqlParams) commonTruncate(tableName, statement string) error {
	sp.queryLogger.LogDDL(statement)

	_, err := sp.dataSource.ExecContext(sp.ctx, statement)

	if err != nil {
		errF := fmt.Errorf("Error truncating table %s using statement: %s: %v", tableName, statement, err)
		return mapError(errF)
	}

	return nil
}

func mapError(err error) error {
	if notExistRegexp.MatchString(err.Error()) {
		return ErrTableNotExist
	}
	return err
}
