package adapters

//TableCreator is a manager for DWH tables
type TableCreator interface {
	GetTableSchema(tableName string) (*Table, error)
	CreateTable(schemaToCreate *Table) error
	PatchTableSchema(schemaToAdd *Table) error
}
