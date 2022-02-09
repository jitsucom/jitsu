package adapters

//AbstractHTTP is an Abstract HTTP adapter for keeping default funcs
type AbstractHTTP struct {
	httpAdapter *HTTPAdapter
}

//Insert passes object to HTTPAdapter
func (a *AbstractHTTP) Insert(insertContext *InsertContext) error {
	return a.httpAdapter.SendAsync(insertContext.eventContext)
}

//GetTableSchema always returns empty table
func (a *AbstractHTTP) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
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

//Type returns adapter type. Should be overridden in every implementation
func (a *AbstractHTTP) Type() string {
	return "AbstractHTTP"
}

func (a *AbstractHTTP) Truncate(tableName string) error {
	return nil
}

//Close closes underlying HTTPAdapter
func (a *AbstractHTTP) Close() error {
	return a.httpAdapter.Close()
}
