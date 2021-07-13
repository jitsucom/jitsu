package adapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
)

const (
	hubSpotContactPropertiesAPIURL = "https://api.hubapi.com/properties/v1/contacts/properties"
)

/*
//HubSpotRequest is a dto for sending requests to HubSpot
type HubSpotRequest struct {
	APIKey string                   `json:"api_key"`
	Events []map[string]interface{} `json:"events"`
}
*/

//HubSpotResponse is a dto for receiving response from HubSpot
type HubSpotResponse struct {
	Category string `json:"category"`
	Status   string `json:"status"`
	Message  string `json:"message"`
}

//HubSpotRequestFactory is a factory for building HubSpot HTTP requests from input events
type HubSpotRequestFactory struct {
	apiKey string
	hubID  string
}

//newHubSpotRequestFactory returns configured HTTPRequestFactory instance for hubspot requests
func newHubSpotRequestFactory(apiKey, hubID string) (HTTPRequestFactory, error) {
	return &HubSpotRequestFactory{apiKey: apiKey, hubID: hubID}, nil
}

//Create returns created amplitude request
//put empty array in body if object is nil (is used in test connection)
func (hf *HubSpotRequestFactory) Create(object map[string]interface{}) (*Request, error) {
	/*//empty array is required. Otherwise nil will be sent (error)
	eventsArr := []map[string]interface{}{}
	if object != nil {
		eventsArr = append(eventsArr, object)
	}

	req := HubSpotRequest{APIKey: arf.apiKey, Events: eventsArr}
	b, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling amplitude request [%v]: %v", req, err)
	}*/
	return &Request{
		URL:     "",
		Method:  http.MethodPost,
		Body:    nil,
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

//HubSpotConfig is a dto for parsing HubSpot configuration
type HubSpotConfig struct {
	APIKey string `mapstructure:"api_key" json:"api_key,omitempty" yaml:"api_key,omitempty"`
	HubID  string `mapstructure:"hub_id" json:"hub_id,omitempty" yaml:"hub_id,omitempty"`
}

//Validate returns err if invalid
func (hc *HubSpotConfig) Validate() error {
	if hc == nil {
		return errors.New("hubspot config is required")
	}
	if hc.APIKey == "" {
		return errors.New("'api_key' is required parameter")
	}
	if hc.HubID == "" {
		return errors.New("'hub_id' is required parameter")
	}

	return nil
}

//HubSpot is an adapter for sending HTTP requests to HubSpot
type HubSpot struct {
	AbstractHTTP

	config *HubSpotConfig
}

//NewHubSpot returns configured HubSpot adapter instance
func NewHubSpot(config *HubSpotConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*HubSpot, error) {
	httpReqFactory, err := newHubSpotRequestFactory(config.APIKey, config.HubID)
	if err != nil {
		return nil, err
	}

	httpAdapterConfiguration.HTTPReqFactory = httpReqFactory

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	h := &HubSpot{config: config}
	h.httpAdapter = httpAdapter
	return h, nil
}

//NewTestHubSpot returns test instance of adapter
func NewTestHubSpot(config *HubSpotConfig) *HubSpot {
	return &HubSpot{config: config}
}

//TestAccess sends test request (empty POST) to HubSpot and check if error has occurred
func (h *HubSpot) TestAccess() error {

	//send empty request and expect error
	r, err := http.DefaultClient.Get(hubSpotContactPropertiesAPIURL + "?hapikey=" + h.config.APIKey)
	if r != nil && r.Body != nil {
		defer r.Body.Close()

		if r.StatusCode == 200 {
			return nil
		}

		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("Error reading hubspot response body: %v", err)
		}

		hr := &HubSpotResponse{}
		err = json.Unmarshal(responseBody, hr)
		if err != nil {
			return fmt.Errorf("Error unmarhalling hubspot conversion API response body: %v", err)
		}

		return fmt.Errorf("Received HTTP code [%d] from HubSpot: %s [%s]: %s", r.StatusCode, hr.Status, hr.Category, hr.Message)
	}

	if err != nil {
		return err
	}

	return errors.New("Empty Facebook response body")
}

//Type returns adapter type
func (h *HubSpot) Type() string {
	return "HubSpot"
}
