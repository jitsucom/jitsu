package adapters

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/parsers"
	"strings"
	"text/template"
)

//HTTPRequestFactory is a factory for creating http.Request from input event object
type HTTPRequestFactory interface {
	Create(object map[string]interface{}) (*Request, error)
}

//WebhookRequestFactory is a factory for building webhook (templating) HTTP requests from input events
type WebhookRequestFactory struct {
	httpMethod string
	urlTmpl    *template.Template
	bodyTmpl   *template.Template
	headers    map[string]string
}

//NewWebhookRequestFactory returns configured HTTPRequestFactory instance for webhook requests
func NewWebhookRequestFactory(httpMethod, urlTmplStr, bodyTmplStr string, headers map[string]string) (HTTPRequestFactory, error) {
	urlTmpl, err := template.New("url").Parse(urlTmplStr)
	if err != nil {
		return nil, fmt.Errorf("Error parsing URL template [%s]: %v", urlTmplStr, err)
	}

	bodyTmpl, err := template.New("body").Funcs(parsers.JSONSerializeFuncs).Parse(bodyTmplStr)
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

	var urlBuf bytes.Buffer
	if err = wrf.urlTmpl.Execute(&urlBuf, object); err != nil {
		return nil, fmt.Errorf("Error executing URL template: %v", err)
	}
	url := strings.TrimSpace(urlBuf.String())

	var bodyBuf bytes.Buffer
	if err = wrf.bodyTmpl.Execute(&bodyBuf, object); err != nil {
		return nil, fmt.Errorf("Error executing body template: %v", err)
	}
	body := []byte(strings.TrimSpace(bodyBuf.String()))

	return &Request{
		URL:     url,
		Method:  wrf.httpMethod,
		Body:    body,
		Headers: wrf.headers,
	}, nil
}
