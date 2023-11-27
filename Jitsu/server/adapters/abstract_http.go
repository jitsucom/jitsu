package adapters

//AbstractHTTP is an Abstract HTTP adapter for keeping default funcs
type AbstractHTTP struct {
	httpAdapter *HTTPAdapter
}

//Insert passes object to HTTPAdapter
func (a *AbstractHTTP) Insert(insertContext *InsertContext) error {
	return a.httpAdapter.SendAsync(insertContext.eventContext)
}

//Type returns adapter type. Should be overridden in every implementation
func (a *AbstractHTTP) Type() string {
	return "AbstractHTTP"
}

//Close closes underlying HTTPAdapter
func (a *AbstractHTTP) Close() error {
	return a.httpAdapter.Close()
}
