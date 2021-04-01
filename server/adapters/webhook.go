package adapters

import (
	"errors"

	"github.com/jitsucom/jitsu/server/logging"
)

// WebHookConfig -
type WebHookConfig struct {
	URL     string            `mapstructure:"url" json:"url,omitempty" yaml:"url,omitempty"`
	Method  string            `mapstructure:"method" json:"method,omitempty" yaml:"method,omitempty"`
	Body    string            `mapstructure:"body" json:"body,omitempty" yaml:"body,omitempty"`
	Headers map[string]string `mapstructure:"headers" json:"headers,omitempty" yaml:"headers,omitempty"`
}

func (whc *WebHookConfig) Validate() error {
	if whc == nil {
		return errors.New("WebHook config is required")
	}
	if whc.URL == "" {
		return errors.New("URL is required parameter")
	}
	if whc.Headers == nil {
		whc.Headers = map[string]string{}
	}

	return nil
}

type WebHookConversion struct {
	config      *WebHookConfig
	httpQueue   *HttpAdapter
	debugLogger *logging.QueryLogger
}

func NewWebHookConversion(config *WebHookConfig, httpQueue *HttpAdapter, requestDebugLogger *logging.QueryLogger) *WebHookConversion {
	return &WebHookConversion{
		config:      config,
		httpQueue:   httpQueue,
		debugLogger: requestDebugLogger,
	}
}

func (wh *WebHookConversion) Send(object map[string]interface{}) error {
	wh.httpQueue.AddRequest(&Request{})

	return nil
}

func (wh *WebHookConversion) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

func (wh *WebHookConversion) CreateTable(schemaToCreate *Table) error {
	return nil
}

func (wh *WebHookConversion) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (wh *WebHookConversion) Close() error {
	return nil
}
