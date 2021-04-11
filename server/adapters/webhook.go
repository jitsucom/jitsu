package adapters

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
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
	config      *WebHookConfig
	httpQueue   *HttpAdapter
	debugLogger *logging.QueryLogger
	urlTmpl     *template.Template
	bodyTmpl    *template.Template
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
		httpQueue:   NewHttpAdapter(),
		debugLogger: requestDebugLogger,
		urlTmpl:     urlTmpl,
		bodyTmpl:    bodyTmpl,
	}, nil
}

func (wh *WebHookConversion) Send(object map[string]interface{}) error {
	url, err := wh.GetURL(object)
	if err != nil {
		return err
	}

	body, err := wh.GetBody(object)
	if err != nil {
		return err
	}

	wh.httpQueue.AddRequest(&Request{
		URL:     url,
		Method:  wh.config.Method,
		Headers: wh.config.Headers,
		Body:    body,
		NextDt:  time.Now(),
	})

	return nil
}

func (wh *WebHookConversion) GetURL(object map[string]interface{}) (string, error) {
	var buf bytes.Buffer
	if err := wh.urlTmpl.Execute(&buf, object); err != nil {
		return "", fmt.Errorf("Error executing %s template: %v", wh.urlTmpl, err)
	}
	return strings.TrimSpace(buf.String()), nil
}

func (wh *WebHookConversion) GetBody(object map[string]interface{}) (string, error) {
	var buf bytes.Buffer
	if err := wh.bodyTmpl.Execute(&buf, object); err != nil {
		return "", fmt.Errorf("Error executing %s template: %v", wh.bodyTmpl, err)
	}
	return strings.TrimSpace(buf.String()), nil
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
