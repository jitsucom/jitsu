package adapters

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/templates"
)

//HTTPRequestFactory is a factory for creating http.Request from input event object
type HTTPRequestFactory interface {
	Create(object map[string]interface{}) (*Request, error)
}

//WebhookRequestFactory is a factory for building webhook (templating) HTTP requests from input events
type WebhookRequestFactory struct {
	httpMethod string
	urlTmpl    templates.TemplateExecutor
	bodyTmpl   templates.TemplateExecutor
	headers    map[string]string
}

//NewWebhookRequestFactory returns configured HTTPRequestFactory instance for webhook requests
func NewWebhookRequestFactory(httpMethod, urlTmplStr, bodyTmplStr string, headers map[string]string) (HTTPRequestFactory, error) {
	urlTmpl, err := templates.SmartParse("url", urlTmplStr, templates.JSONSerializeFuncs)
	if err != nil {
		return nil, fmt.Errorf("Error parsing URL template [%s]: %v", urlTmplStr, err)
	}

	bodyTmpl, err := templates.SmartParse("body", bodyTmplStr, templates.JSONSerializeFuncs)
	if err != nil {
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

	url, err := wrf.urlTmpl.ProcessEvent(object)
	if err != nil {
		return nil, fmt.Errorf("Error executing URL template: %v", err)
	}

	rawBody, err := wrf.bodyTmpl.ProcessEvent(object)
	if err != nil {
		return nil, fmt.Errorf("Error executing body template: %v", err)
	}
	body, err := templates.ToJSON(rawBody)
	if err != nil {
		return nil, err
	}

	return &Request{
		URL:     templates.ToString(url, false, false, false),
		Method:  wrf.httpMethod,
		Body:    body,
		Headers: wrf.headers,
	}, nil
}

func (wrf *WebhookRequestFactory) Close() {
	wrf.urlTmpl.Close()
	wrf.bodyTmpl.Close()
}