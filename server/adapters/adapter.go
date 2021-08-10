package adapters

import "io"

//SQLAdapter is a manager for DWH tables
type SQLAdapter interface {
	Adapter
	GetTableSchema(tableName string) (*Table, error)
	CreateTable(schemaToCreate *Table) error
	PatchTableSchema(schemaToAdd *Table) error
	BulkInsert(table *Table, objects []map[string]interface{}) error
	BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error
	Clean(tableName string) error
}

//Adapter is an adapter for all destinations
type Adapter interface {
	io.Closer
	Insert(eventContext *EventContext) error
}
