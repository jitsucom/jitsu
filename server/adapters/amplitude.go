package adapters

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
)

const (
	amplitudeAPIURL = "https://api.amplitude.com/2/httpapi"

	extractKey = "_extract"
)

//AmplitudeRequest is a dto for sending requests to Amplitude
type AmplitudeRequest struct {
	APIKey string                   `json:"api_key"`
	Events []map[string]interface{} `json:"events"`
}

//AmplitudeResponse is a dto for receiving response from Amplitude
type AmplitudeResponse struct {
	Code int `json:"code"`
}

//AmplitudeRequestFactory is a factory for building Amplitude HTTP requests from input events
type AmplitudeRequestFactory struct {
	apiKey string
}

//newAmplitudeRequestFactory returns configured HTTPRequestFactory instance for amplitude requests
func newAmplitudeRequestFactory(apiKey string) (HTTPRequestFactory, error) {
	return &AmplitudeRequestFactory{apiKey: apiKey}, nil
}

//Create returns created amplitude request
func (arf *AmplitudeRequestFactory) Create(object map[string]interface{}) (*Request, error) {
	req := AmplitudeRequest{APIKey: arf.apiKey, Events: []map[string]interface{}{object}}
	b, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling amplitude request [%v]: %v", req, err)
	}
	return &Request{
		URL:     amplitudeAPIURL,
		Method:  http.MethodPost,
		Body:    b,
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

//AmplitudeConfig is a dto for parsing Amplitude configuration
type AmplitudeConfig struct {
	APIKey string `mapstructure:"api_key" json:"api_key,omitempty" yaml:"api_key,omitempty"`
}

//Validate returns err if invalid
func (ac *AmplitudeConfig) Validate() error {
	if ac == nil {
		return errors.New("amplitude config is required")
	}
	if ac.APIKey == "" {
		return errors.New("'api_key' is required parameter")
	}

	return nil
}

//Amplitude is an adapter for sending HTTP requests to Amplitude
type Amplitude struct {
	httpAdapter *HTTPAdapter
}

//NewAmplitude returns configured Amplitude adapter instance
func NewAmplitude(config *AmplitudeConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*Amplitude, error) {
	httpReqFactory, err := newAmplitudeRequestFactory(config.APIKey)
	if err != nil {
		return nil, err
	}

	httpAdapterConfiguration.HTTPReqFactory = httpReqFactory

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	return &Amplitude{httpAdapter: httpAdapter}, nil
}

//Insert passes object to HTTPAdapter
func (a *Amplitude) Insert(eventContext *EventContext) error {
	return a.httpAdapter.SendAsync(eventContext)
}

//GetTableSchema always returns empty table
func (a *Amplitude) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable returns nil
func (a *Amplitude) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema returns nil
func (a *Amplitude) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (a *Amplitude) BulkInsert(table *Table, objects []map[string]interface{}) error {
	return fmt.Errorf("Amplitude doesn't support BulkInsert() func")
}

func (a *Amplitude) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	return fmt.Errorf("Amplitude doesn't support BulkUpdate() func")
}

//TestAccess sends test request (empty POST) to Amplitude and check if error has occurred
func (a *Amplitude) TestAccess() error {
	r, err := a.httpAdapter.httpReqFactory.Create(map[string]interface{}{})
	if err != nil {
		return err
	}

	httpReq, err := http.NewRequest(r.Method, r.URL, bytes.NewBuffer(r.Body))
	if err != nil {
		return err
	}

	for k, v := range r.Headers {
		httpReq.Header.Add(k, v)
	}

	//send empty request and expect error
	resp, err := http.DefaultClient.Do(httpReq)
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()

		responseBody, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("Error reading amplitude response body: %v", err)
		}

		response := &AmplitudeResponse{}
		err = json.Unmarshal(responseBody, response)
		if err != nil {
			return fmt.Errorf("Error unmarhalling amplitude response body: %v", err)
		}

		if response.Code != 200 {
			return fmt.Errorf("Error connecting to amplitude: [code=%d]", response.Code)
		}

		//assume other errors - it's ok
		return nil
	}

	return err
}

//Close closes underlying HTTPAdapter
func (a *Amplitude) Close() error {
	return a.httpAdapter.Close()
}
