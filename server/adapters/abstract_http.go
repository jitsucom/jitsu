package adapters

import "fmt"

//AbstractHTTP is an Abstract HTTP adapter for keeping default funcs
type AbstractHTTP struct {
	httpAdapter *HTTPAdapter
}

//Insert passes object to HTTPAdapter
func (a *AbstractHTTP) Insert(eventContext *EventContext) error {
	return a.httpAdapter.SendAsync(eventContext)
}

//GetTableSchema always returns empty table
func (a *AbstractHTTP) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable returns nil
func (a *AbstractHTTP) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema returns nil
func (a *AbstractHTTP) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (a *AbstractHTTP) BulkInsert(table *Table, objects []map[string]interface{}) error {
	return fmt.Errorf("%s doesn't support BulkInsert() func", a.Type())
}

func (a *AbstractHTTP) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	return fmt.Errorf("%s doesn't support BulkUpdate() func", a.Type())
}

//Type returns adapter type. Should be overridden in every implementation
func (a *AbstractHTTP) Type() string {
	return "AbstractHTTP"
}

func (a *AbstractHTTP) Clean(tableName string) error {
	return nil
}

//Close closes underlying HTTPAdapter
func (a *AbstractHTTP) Close() error {
	return a.httpAdapter.Close()
}
