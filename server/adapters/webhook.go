package adapters

import (
	"errors"
	"fmt"
	"text/template"
	"time"

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
	config              *WebHookConfig
	httpQueue           *HttpAdapter
	debugLogger         *logging.QueryLogger
	urlTmpl             *template.Template
	bodyTmpl            *template.Template
	RequestFailCallback func(object map[string]interface{}, err error)
}

func NewWebHookConversion(config *WebHookConfig, requestDebugLogger *logging.QueryLogger) (*WebHookConversion, error) {
	urlTmpl, err := template.New("url").Parse(config.URL)
	if err != nil {
		return nil, fmt.Errorf("Error parsing URL template %v", err)
	}

	bodyTmpl, err := template.New("body").Parse(config.Body)
	if err != nil {
		return nil, fmt.Errorf("Error parsing body template %v", err)
	}

	return &WebHookConversion{
		config:      config,
		debugLogger: requestDebugLogger,
		urlTmpl:     urlTmpl,
		bodyTmpl:    bodyTmpl,
		httpQueue:   NewHttpAdapter(10*time.Second, 1*time.Second, 1000, 1000, 1000, 1, 3),
	}, nil
}

func (wh *WebHookConversion) Send(object map[string]interface{}) error {
	wh.httpQueue.AddRequest(&Request{
		Event:    object,
		Method:   wh.config.Method,
		URLTmpl:  wh.urlTmpl,
		BodyTmpl: wh.bodyTmpl,
		Headers:  wh.config.Headers,
		Callback: wh.RequestFailCallback,
	})

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
	wh.httpQueue.Close()
	return nil
}
