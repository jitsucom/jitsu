package adapters

import (
	"encoding/json"
	"fmt"
	"github.com/mitchellh/mapstructure"
)

//Npm is an adapter for sending HTTP request based on result of running javascript SDK destinations
type Npm struct {
	AbstractHTTP
}

type NpmRequestFactory struct {
}

//NewNpm returns configured Npm adapter instance
func NewNpm(httpAdapterConfiguration *HTTPAdapterConfiguration) (*Npm, error) {

	npm := &Npm{}

	httpAdapterConfiguration.HTTPReqFactory = &NpmRequestFactory{}

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	npm.httpAdapter = httpAdapter

	return npm, nil
}

//Create returns created http.Request with templates
func (n *NpmRequestFactory) Create(object map[string]interface{}) (req *Request, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			req = nil
			err = fmt.Errorf("Error constructing webhook request: %v", r)
		}
	}()
	var envelop Envelop
	if err := mapstructure.Decode(object, &envelop); err != nil {
		return nil, fmt.Errorf("cannot parse DestinationMessage: %v", err)
	}
	var body []byte
	switch b := envelop.Body.(type) {
	case string:
		body = []byte(b)
	case []byte:
		body = b
	default:
		body, err = json.Marshal(b)
		if err != nil {
			return nil, fmt.Errorf("cannot marshal DestinationMessage body: %v", err)
		}
	}

	return &Request{
		URL:     envelop.URL,
		Method:  envelop.Method,
		Body:    body,
		Headers: envelop.Headers,
	}, nil
}

func (n *NpmRequestFactory) Close() {
}

//Type returns adapter type
func (n *Npm) Type() string {
	return "npm"
}
