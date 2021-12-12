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
	URL     string            `mapstructure:"url,omitempty" json:"url,omitempty" yaml:"url,omitempty"`
	Method  string            `mapstructure:"method,omitempty" json:"method,omitempty" yaml:"method,omitempty"`
	Body    string            `mapstructure:"body,omitempty" json:"body,omitempty" yaml:"body,omitempty"`
	Headers map[string]string `mapstructure:"headers,omitempty" json:"headers,omitempty" yaml:"headers,omitempty"`
}

//Validate returns err if invalid
func (whc *WebHookConfig) Validate() error {
	if whc == nil {
		return errors.New("webHook config is required")
	}

	return nil
}

//WebHook is an adapter for sending HTTP requests with configurable HTTP parameters (URL, body, headers)
type WebHook struct {
	AbstractHTTP
}

//NewWebHook returns configured WebHook adapter instance
func NewWebHook(config *WebHookConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*WebHook, error) {

	httpReqFactory, err := NewWebhookRequestFactory(httpAdapterConfiguration.DestinationID, "webhook", config.Method, config.URL, config.Body, config.Headers)
	if err != nil {
		return nil, err
	}

	httpAdapterConfiguration.HTTPReqFactory = httpReqFactory

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	wh := &WebHook{}
	wh.httpAdapter = httpAdapter

	return wh, nil
}

//Type returns adapter type
func (wh *WebHook) Type() string {
	return "WebHook"
}
