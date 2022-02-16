package test

import (
	"database/sql"
	"io"
)

type ContainerWrapper struct {
	Container Container
}

type Container interface {
	io.Closer
	CountRows(table string) (int, error)
	GetSortedRows(table, selectClause, whereClause, orderClause string) ([]map[string]interface{}, error)
}

func extractData(rows *sql.Rows) ([]map[string]interface{}, error) {
	cols, _ := rows.Columns()

	objects := []map[string]interface{}{}
	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		// Scan the result into the column pointers...
		if err := rows.Scan(columnPointers...); err != nil {
			return nil, err
		}

		// Create our map, and retrieve the value for each column from the pointers slice,
		// storing it in the map with the name of the column as the key.
		object := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			object[colName] = *val
		}

		objects = append(objects, object)
	}

	return objects, nil
}
