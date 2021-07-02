package adapters

//SQLAdapter is a manager for DWH tables
type SQLAdapter interface {
	CreateDB(databaseName string) error
	Insert(eventContext *EventContext) error
	GetTableSchema(tableName string) (*Table, error)
	CreateTable(schemaToCreate *Table) error
	PatchTableSchema(schemaToAdd *Table) error
	BulkInsert(table *Table, objects []map[string]interface{}) error
	BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error
}
