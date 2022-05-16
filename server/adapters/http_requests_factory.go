package adapters

import (
	"encoding/json"
	"fmt"

	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
)

type Envelop struct {
	URL     string            `mapstructure:"url"`
	Method  string            `mapstructure:"method"`
	Headers map[string]string `mapstructure:"headers"`
	Body    interface{}       `mapstructure:"body"`
}

//HTTPRequestFactory is a factory for creating http.Request from input event object
type HTTPRequestFactory interface {
	Create(object map[string]interface{}) (*Request, error)
	Close()
}

//WebhookRequestFactory is a factory for building webhook (templating) HTTP requests from input events
type WebhookRequestFactory struct {
	httpMethod string
	urlTmpl    templates.TemplateExecutor
	bodyTmpl   templates.TemplateExecutor
	headers    map[string]string
}

//NewWebhookRequestFactory returns configured HTTPRequestFactory instance for webhook requests
func NewWebhookRequestFactory(destinationID, destinationType, httpMethod, urlTmplStr, bodyTmplStr string, headers map[string]string) (HTTPRequestFactory, error) {
	var templateFunctions = templates.EnrichedFuncMap(map[string]interface{}{"destinationId": destinationID, "destinationType": destinationType})
	urlTmpl, err := templates.SmartParse("url", urlTmplStr, templateFunctions)
	if err != nil {
		return nil, fmt.Errorf("Error parsing URL template [%s]: %v", urlTmplStr, err)
	}

	bodyTmpl, err := templates.SmartParse("body", bodyTmplStr, templateFunctions)
	if err != nil {
		urlTmpl.Close()
		return nil, fmt.Errorf("Error parsing body template [%s]: %v", bodyTmplStr, err)
	}
	return &WebhookRequestFactory{
		httpMethod: httpMethod,
		urlTmpl:    urlTmpl,
		bodyTmpl:   bodyTmpl,
		headers:    headers,
	}, nil
}

//Create returns created http.Request with templates
func (wrf *WebhookRequestFactory) Create(object map[string]interface{}) (req *Request, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			req = nil
			err = fmt.Errorf("Error constructing webhook request: %v", r)
		}
	}()
	var body []byte
	headers := make(map[string]string)
	var envelop Envelop
	envl, ok := object[schema.JitsuEnvelopParameter]
	if ok {
		delete(object, schema.JitsuEnvelopParameter)
		if err := mapstructure.Decode(envl, &envelop); err != nil {
			return nil, fmt.Errorf("cannot parse %s: %v", schema.JitsuEnvelopParameter, err)
		}
	}
	if envelop.URL == "" {
		rawUrl, err := wrf.urlTmpl.ProcessEvent(object, nil)
		if err != nil {
			return nil, fmt.Errorf("Error executing URL template: %v", err)
		}
		envelop.URL = templates.ToString(rawUrl, false, false, false)
	}
	if envelop.Method == "" {
		envelop.Method = wrf.httpMethod
	}
	utils.StringMapPutAll(headers, wrf.headers)
	utils.StringMapPutAll(headers, envelop.Headers)

	if envelop.Body == nil {
		rawBody, err := wrf.bodyTmpl.ProcessEvent(object, nil)
		if err != nil {
			return nil, fmt.Errorf("Error executing body template: %v", err)
		}
		body, err = templates.ToJSONorStringBytes(rawBody)
		if err != nil {
			return nil, err
		}
	} else {
		switch b := envelop.Body.(type) {
		case string:
			body = []byte(b)
		case []byte:
			body = b
		default:
			body, err = json.Marshal(b)
			if err != nil {
				return nil, fmt.Errorf("cannot marshal JITSU_ENVELOP body: %v", err)
			}
		}
	}

	return &Request{
		URL:     envelop.URL,
		Method:  envelop.Method,
		Body:    body,
		Headers: headers,
	}, nil
}

func (wrf *WebhookRequestFactory) Close() {
	wrf.urlTmpl.Close()
	wrf.bodyTmpl.Close()
}
