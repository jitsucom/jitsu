package adapters

import "github.com/jitsucom/eventnative/schema"

type TableManager interface {
	GetTableSchema(tableName string) (*schema.Table, error)
	CreateTable(schemaToCreate *schema.Table) error
	PatchTableSchema(schemaToAdd *schema.Table) error
	UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error
}
