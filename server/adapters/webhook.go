package adapters

import (
	"errors"

	"github.com/jitsucom/jitsu/server/typing"
)

var (
	//DefaultSchemaTypeMappings is dummy mappings
	DefaultSchemaTypeMappings = map[typing.DataType]string{
		typing.STRING:    "string",
		typing.INT64:     "string",
		typing.FLOAT64:   "string",
		typing.TIMESTAMP: "string",
		typing.BOOL:      "string",
		typing.UNKNOWN:   "string",
	}
)

//WebHookConfig is a dto for parsing Webhook configuration
type WebHookConfig struct {
	URL     string            `mapstructure:"url" json:"url,omitempty" yaml:"url,omitempty"`
	Method  string            `mapstructure:"method" json:"method,omitempty" yaml:"method,omitempty"`
	Body    string            `mapstructure:"body" json:"body,omitempty" yaml:"body,omitempty"`
	Headers map[string]string `mapstructure:"headers" json:"headers,omitempty" yaml:"headers,omitempty"`
}

//Validate returns err if invalid
func (whc *WebHookConfig) Validate() error {
	if whc == nil {
		return errors.New("webHook config is required")
	}
	if whc.URL == "" {
		return errors.New("'url' is required parameter")
	}

	return nil
}

//WebHook is an adapter for sending HTTP requests with configurable HTTP parameters (URL, body, headers)
type WebHook struct {
	httpAdapter *HTTPAdapter
}

//NewWebHook returns configured WebHook adapter instance
func NewWebHook(config *WebHookConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*WebHook, error) {
	httpReqFactory, err := NewWebhookRequestFactory(config.Method, config.URL, config.Body, config.Headers)
	if err != nil {
		return nil, err
	}

	httpAdapterConfiguration.HTTPReqFactory = httpReqFactory

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	return &WebHook{httpAdapter: httpAdapter}, nil
}

//Insert passes object to HTTPAdapter
func (wh *WebHook) Insert(eventContext *EventContext) error {
	return wh.httpAdapter.SendAsync(eventContext)
}

//GetTableSchema always returns empty table
func (wh *WebHook) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable returns nil
func (wh *WebHook) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema returns nil
func (wh *WebHook) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

// DeleteTable returns nil
func (wh *WebHook) DeleteTable(schemaToDelete *Table) error {
	return nil
}

//Close closes underlying HTTPAdapter
func (wh *WebHook) Close() error {
	return wh.httpAdapter.Close()
}
