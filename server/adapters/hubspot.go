package adapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"io/ioutil"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	hubSpotContactPropertiesAPIURLTemplate   = "https://api.hubapi.com/properties/v1/contacts/properties"
	hubSpotContactWithEmailAPIURLTemplate    = "https://api.hubapi.com/contacts/v1/contact/createOrUpdate/email/%v"
	hubSpotContactWithoutEmailAPIURLTemplate = "https://api.hubapi.com/contacts/v1/contact"
	hubSpotEventURL                          = "https://track.hubspot.com/v1/event"
	JitsuUserAgent                           = "Jitsu.com/1.0"
)

var (
	alphaNumericReplacer = regexp.MustCompile("[^a-zA-Z0-9]+")
	userPath             = jsonutils.NewJSONPath("/user||/eventn_ctx/user")
	userEmailPath        = jsonutils.NewJSONPath("/user/email||/eventn_ctx/user/email")
	revenuePath          = jsonutils.NewJSONPath("/revenue||/conversion/revenue")
)

// HubSpotContactProperty is a dto for serializing contact (user) properties from HubSpot
type HubSpotContactProperty struct {
	Name string `json:"name"`
}

// HubSpotContactPropertyWithValues is a dto for serializing contact (user) properties that are sent to HubSpot
type HubSpotContactPropertyWithValues struct {
	Property string      `json:"property"`
	Value    interface{} `json:"value"`
}

// HubSpotResponse is a dto for receiving response from HubSpot
type HubSpotResponse struct {
	Category string `json:"category"`
	Status   string `json:"status"`
	Message  string `json:"message"`
}

// HubSpotContactRequest is a dto for sending contact requests to HubSpot
type HubSpotContactRequest struct {
	Properties []HubSpotContactPropertyWithValues `json:"properties"`
}

// HubSpotRequestFactory is a factory for building HubSpot HTTP requests from input events
// reloads properties configuration every minutes in background goroutine
type HubSpotRequestFactory struct {
	mutex       *sync.RWMutex
	apiKey      string
	accessToken string
	hubID       string

	userProperties map[string]bool

	closed *atomic.Bool
}

// newHubSpotRequestFactory returns configured HTTPRequestFactory instance for hubspot requests
// starts goroutine for getting user properties
func newHubSpotRequestFactory(apiKey, hubID, accessToken string) (*HubSpotRequestFactory, error) {
	hf := &HubSpotRequestFactory{
		mutex:       &sync.RWMutex{},
		apiKey:      apiKey,
		accessToken: accessToken,
		hubID:       hubID,
		closed:      atomic.NewBool(false),
	}

	userProperties, err := loadContactProperties(accessToken, apiKey)
	if err != nil {
		return nil, fmt.Errorf("Error loading contact properties: %v", err)
	}
	hf.userProperties = userProperties
	hf.start()
	return hf, nil
}

// start runs a goroutines that gets user properties every 1 minute
func (hf *HubSpotRequestFactory) start() {
	safego.RunWithRestart(func() {
		for {
			if hf.closed.Load() {
				break
			}

			properties, err := loadContactProperties(hf.accessToken, hf.apiKey)
			if err != nil {
				logging.Errorf("Error loading contact properties for [%s] Hub ID: %v", hf.hubID, err)
			} else {
				hf.mutex.Lock()
				hf.userProperties = properties
				hf.mutex.Unlock()
			}

			time.Sleep(time.Minute)
		}
	})
}

// Create returns created hubspot request depends on event type
func (hf *HubSpotRequestFactory) Create(object map[string]interface{}) (*Request, error) {
	eventType, ok := object[events.EventType]
	if !ok {
		eventType = "unknown"
	}

	hf.mutex.RLock()
	userProperties := maputils.CopySet(hf.userProperties)
	hf.mutex.RUnlock()

	objectUserProperties := hf.extractUserProperties(object, userProperties)

	//contact request
	if eventType == events.UserIdentify {
		reqURL := hubSpotContactWithoutEmailAPIURLTemplate
		if email, ok := userEmailPath.Get(object); ok {
			reqURL = fmt.Sprintf(hubSpotContactWithEmailAPIURLTemplate, email)
		}
		headers := map[string]string{"Content-Type": "application/json", "user-agent": JitsuUserAgent}
		if hf.accessToken != "" {
			headers["Authorization"] = "Bearer " + hf.accessToken
		} else {
			reqURL += "?hapikey=" + hf.apiKey
		}

		body := HubSpotContactRequest{Properties: objectUserProperties}
		b, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		return &Request{
			URL:     reqURL,
			Method:  http.MethodPost,
			Body:    b,
			Headers: headers,
		}, nil
	} else {
		//event request
		query := url.Values{}
		query.Add("_a", hf.hubID)
		query.Add("_n", fmt.Sprint(eventType))
		r, ok := revenuePath.Get(object)
		if ok {
			query.Add("_m", fmt.Sprint(r))
		}

		for _, prop := range objectUserProperties {
			query.Add(prop.Property, fmt.Sprint(prop.Value))
		}

		return &Request{
			URL:     hubSpotEventURL + "?" + query.Encode(),
			Method:  http.MethodGet,
			Body:    nil,
			Headers: map[string]string{"Content-Type": "application/json", "user-agent": JitsuUserAgent},
		}, nil
	}
}

// Close closes underlying goroutine
func (hf *HubSpotRequestFactory) Close() {
	hf.closed.Store(true)
}

// extractUserProperties returns hubspot user properties from input objects
func (hf *HubSpotRequestFactory) extractUserProperties(object map[string]interface{}, properties map[string]bool) []HubSpotContactPropertyWithValues {
	result := []HubSpotContactPropertyWithValues{}

	userObj, ok := userPath.Get(object)
	if ok {
		user, ok := userObj.(map[string]interface{})
		if ok {
			for userField, value := range user {
				reformattedUserField := reformatFieldName(userField)
				if _, ok := properties[reformattedUserField]; ok {
					//don't pass empty strings
					if fmt.Sprint(value) != "" {
						result = append(result, HubSpotContactPropertyWithValues{
							Property: reformattedUserField,
							Value:    value,
						})
					}
				}
			}
		}
	}

	return result
}

// HubSpotConfig is a dto for parsing HubSpot configuration
type HubSpotConfig struct {
	APIKey      string `mapstructure:"api_key,omitempty" json:"api_key,omitempty" yaml:"api_key,omitempty"`
	AccessToken string `mapstructure:"access_token,omitempty" json:"access_token,omitempty" yaml:"access_token,omitempty"`
	HubID       string `mapstructure:"hub_id,omitempty" json:"hub_id,omitempty" yaml:"hub_id,omitempty"`
}

// Validate returns err if invalid
func (hc *HubSpotConfig) Validate() error {
	if hc == nil {
		return errors.New("hubspot config is required")
	}
	if hc.APIKey == "" && hc.AccessToken == "" {
		return errors.New("'access_token' or 'api_key' must be provided")
	}
	if hc.HubID == "" {
		return errors.New("'hub_id' is required parameter")
	}

	return nil
}

// HubSpot is an adapter for sending HTTP requests to HubSpot
type HubSpot struct {
	AbstractHTTP

	config *HubSpotConfig
}

// NewHubSpot returns configured HubSpot adapter instance
func NewHubSpot(config *HubSpotConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*HubSpot, error) {
	httpReqFactory, err := newHubSpotRequestFactory(config.APIKey, config.HubID, config.AccessToken)
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

// NewTestHubSpot returns test instance of adapter
func NewTestHubSpot(config *HubSpotConfig) *HubSpot {
	return &HubSpot{config: config}
}

// TestAccess sends get user properties request to HubSpot and check if error has occurred
func (h *HubSpot) TestAccess() error {
	_, err := loadContactProperties(h.config.AccessToken, h.config.APIKey)
	return err
}

// Type returns adapter type
func (h *HubSpot) Type() string {
	return "HubSpot"
}

// loadContactProperties requests (HTTP GET) contact properties from HubSpot
func loadContactProperties(accessToken, apiKey string) (map[string]bool, error) {
	headers := map[string]string{"user-agent": JitsuUserAgent}
	reqURL := hubSpotContactPropertiesAPIURLTemplate
	if accessToken != "" {
		headers["Authorization"] = "Bearer " + accessToken
	} else {
		reqURL += "?hapikey=" + apiKey
	}
	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Add(k, v)
	}
	r, err := http.DefaultClient.Do(req)
	if r != nil && r.Body != nil {
		defer r.Body.Close()

		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return nil, fmt.Errorf("error reading hubspot response body: %v", err)
		}

		if r.StatusCode == 200 {
			hubspotProperties := []HubSpotContactProperty{}
			err = json.Unmarshal(responseBody, &hubspotProperties)
			if err != nil {
				return nil, fmt.Errorf("error unmarshalling hubspot response body: %v", err)
			}

			properties := map[string]bool{}
			for _, hp := range hubspotProperties {
				properties[hp.Name] = true
			}

			return properties, nil
		}

		hr := &HubSpotResponse{}
		err = json.Unmarshal(responseBody, hr)
		if err != nil {
			return nil, fmt.Errorf("error unmarshalling hubspot response body: %v", err)
		}

		return nil, fmt.Errorf("received HTTP code [%d] from HubSpot: %s [%s]: %s", r.StatusCode, hr.Status, hr.Category, hr.Message)
	}

	if err != nil {
		return nil, err
	}

	return nil, errors.New("Empty HubSpot response body")
}

func reformatFieldName(name string) string {
	return strings.ToLower(alphaNumericReplacer.ReplaceAllString(name, "_"))
}
