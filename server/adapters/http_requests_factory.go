package adapters

import (
	"bytes"
	"fmt"
	"net/http"
	"strings"
	"text/template"
)

//HTTPRequestFactory is a factory for creating http.Request from input event object
type HTTPRequestFactory interface {
	Create(object map[string]interface{}) (*http.Request, error)
}

//Request is a dto for building http.Request
type Request struct {
	Event    map[string]interface{}
	Method   string
	URLTmpl  *template.Template
	BodyTmpl *template.Template
	Headers  map[string]string

	OverriddenHTTPRequest *http.Request
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

	bodyTmpl, err := template.New("body").Parse(bodyTmplStr)
	if err != nil {
		return nil, fmt.Errorf("Error parsing body template [%s]: %v", bodyTmpl, err)
	}

	return &WebhookRequestFactory{
		httpMethod: httpMethod,
		urlTmpl:    urlTmpl,
		bodyTmpl:   bodyTmpl,
		headers:    headers,
	}, nil
}

//Create returns created http.Request with templates
func (wrf *WebhookRequestFactory) Create(object map[string]interface{}) (*http.Request, error) {
	var urlBuf bytes.Buffer
	if err := wrf.urlTmpl.Execute(&urlBuf, object); err != nil {
		return nil, fmt.Errorf("Error executing URL template: %v", err)
	}
	url := strings.TrimSpace(urlBuf.String())

	var bodyBuf bytes.Buffer
	if err := wrf.bodyTmpl.Execute(&bodyBuf, object); err != nil {
		return nil, fmt.Errorf("Error executing body template: %v", err)
	}
	body := []byte(strings.TrimSpace(bodyBuf.String()))

	httpReq, err := http.NewRequest(wrf.httpMethod, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	for header, value := range wrf.headers {
		httpReq.Header.Add(header, value)
	}

	return httpReq, nil
}
