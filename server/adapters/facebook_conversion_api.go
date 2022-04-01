package adapters

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"io/ioutil"
	"net/http"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const (
	eventsURLTemplate = "https://graph.facebook.com/v13.0/%s/events?access_token=%s&locale=en_EN"
)

var (
	fbEventTypeMapping = map[string]string{
		"page":       "PageView",
		"pageview":   "PageView",
		"app_page":   "PageView",
		"conversion": "Purchase",
		"signup":     "CompleteRegistration",
	}

	//email (em) has custom handling below
	fieldsToHash = []string{"ph", "ge", "db", "ln", "fn", "ct", "st", "zp", "country"}
)

//FacebookConversionAPIConfig dto for deserialized datasource config (e.g. in Facebook destination)
type FacebookConversionAPIConfig struct {
	PixelID     string `mapstructure:"pixel_id,omitempty" json:"pixel_id,omitempty" yaml:"pixel_id,omitempty"`
	AccessToken string `mapstructure:"access_token,omitempty" json:"access_token,omitempty" yaml:"access_token,omitempty"`
}

//Validate required fields in FacebookConversionAPIConfig
func (fmc *FacebookConversionAPIConfig) Validate() error {
	if fmc == nil {
		return errors.New("facebook config is required")
	}
	if fmc.PixelID == "" {
		return errors.New("pixel_id is required parameter")
	}

	if fmc.AccessToken == "" {
		return errors.New("access_token is required parameter")
	}

	return nil
}

//FacebookResponse is a dto for parsing Facebook response
type FacebookResponse struct {
	Error FacebookResponseErr `json:"error,omitempty"`
}

//FacebookResponseErr is a dto for parsing Facebook response error
type FacebookResponseErr struct {
	Message string `json:"message,omitempty"`
	Type    string `json:"type,omitempty"`
	Code    int    `json:"code,omitempty"`
}

//FacebookConversionEventsReq is sent to Facebook Conversion API
//https://developers.facebook.com/docs/marketing-api/conversions-api/using-the-api#
type FacebookConversionEventsReq struct {
	Data          []map[string]interface{} `json:"data,omitempty"`
	TestEventCode string                   `json:"test_event_code,omitempty"`
}

//FacebookConversionAPI adapter for Facebook Conversion API
type FacebookConversionAPI struct {
	AbstractHTTP

	config *FacebookConversionAPIConfig
}

//NewTestFacebookConversion returns test instance of adapter
func NewTestFacebookConversion(config *FacebookConversionAPIConfig) *FacebookConversionAPI {
	return &FacebookConversionAPI{config: config}
}

//NewFacebookConversion returns new instance of adapter
func NewFacebookConversion(config *FacebookConversionAPIConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*FacebookConversionAPI, error) {
	httpAdapterConfiguration.HTTPReqFactory = &FacebookRequestFactory{config: config}

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	fca := &FacebookConversionAPI{config: config}
	fca.httpAdapter = httpAdapter
	return fca, nil
}

//TestAccess sends test request (empty POST) to Facebook and check if pixel id or access token are invalid
func (fc *FacebookConversionAPI) TestAccess() error {
	reqURL := fmt.Sprintf(eventsURLTemplate, fc.config.PixelID, fc.config.AccessToken)
	reqBody := &FacebookConversionEventsReq{}

	bodyPayload, _ := json.Marshal(reqBody)

	//send empty request and expect error
	r, err := http.DefaultClient.Post(reqURL, "application/json", bytes.NewBuffer(bodyPayload))
	if r != nil && r.Body != nil {
		defer r.Body.Close()

		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("Error reading facebook conversion API response body: %v", err)
		}

		response := &FacebookResponse{}
		err = json.Unmarshal(responseBody, response)
		if err != nil {
			return fmt.Errorf("Error unmarshalling facebook conversion API response body: %v", err)
		}

		if response.Error.Code == 190 {
			return fmt.Errorf("Access token is invalid: %s", response.Error.Message)
		}

		if response.Error.Code == 803 || (response.Error.Code == 100 && response.Error.Type == "GraphMethodException") {
			return fmt.Errorf("Pixel ID is invalid: %s", response.Error.Message)
		}

		//assume other errors - it's ok
		return nil
	}

	if err != nil {
		return err
	}

	return errors.New("Empty Facebook response body")
}

//Type returns adapter type
func (fc *FacebookConversionAPI) Type() string {
	return "FacebookConversionAPI"
}

//FacebookRequestFactory is a factory for building facebook POST HTTP requests from input events
type FacebookRequestFactory struct {
	config *FacebookConversionAPIConfig
}

//Create returns created http.Request
//transforms parameters (event_time -> unix timestamp)
//maps input event_type(event_name) with standard
//hashes fields according to documentation
func (frf *FacebookRequestFactory) Create(object map[string]interface{}) (*Request, error) {
	// ** Parameters transformation **
	// * action_source
	_, ok := object["action_source"]
	if !ok {
		object["action_source"] = "website"
	}

	// * event_time
	frf.enrichWithEventTime(object)

	// * event_name
	eventName, ok := object["event_name"]
	if !ok {
		return nil, fmt.Errorf("Object doesn't have event_name")
	}

	eventNameStr, ok := eventName.(string)
	if !ok {
		return nil, fmt.Errorf("event_name must be string: %T", eventName)
	}

	mappedEventName, ok := fbEventTypeMapping[eventNameStr]
	if ok {
		object["event_name"] = mappedEventName
	}

	frf.hashFields(object)

	//* test_event_code
	var testEventCodeStr string
	testEventCode, testEventCodeExists := object["test_event_code"]
	if testEventCodeExists {
		delete(object, "test_event_code")
		testEventCodeStr = fmt.Sprint(testEventCode)
	}

	//creating
	reqURL := fmt.Sprintf(eventsURLTemplate, frf.config.PixelID, frf.config.AccessToken)
	reqBody := &FacebookConversionEventsReq{Data: []map[string]interface{}{object}, TestEventCode: testEventCodeStr}
	bodyPayload, _ := json.Marshal(reqBody)

	return &Request{
		URL:     reqURL,
		Method:  http.MethodPost,
		Body:    bodyPayload,
		Headers: map[string]string{"Content-Type": "application/json"},
	}, nil
}

func (frf *FacebookRequestFactory) enrichWithEventTime(object map[string]interface{}) {
	eventTime := timestamp.Now().UTC()
	// * event_time
	t, ok := object[timestamp.Key]
	if ok {
		switch t.(type) {
		case time.Time:
			eventTime = t.(time.Time)
		case string:
			eTime, err := time.Parse(time.RFC3339Nano, t.(string))
			if err != nil {
				logging.Errorf("Error parsing %s in facebook event: %v", timestamp.Key, err)
			} else {
				eventTime = eTime
			}
		}
	}

	object["event_time"] = eventTime.Unix()

	delete(object, timestamp.Key)
}

//hashFields hash fields from 'user_data' object according to
//https://developers.facebook.com/docs/marketing-api/conversions-api/parameters/customer-information-parameters
func (frf *FacebookRequestFactory) hashFields(object map[string]interface{}) {
	iface, ok := object["user_data"]
	if !ok {
		return
	}

	userData, ok := iface.(map[string]interface{})
	if !ok {
		return
	}

	for _, field := range fieldsToHash {
		v, ok := userData[field]
		if ok {
			original := []byte(fmt.Sprintf("%v", v))
			sum := sha256.Sum256(original)
			userData[field] = fmt.Sprintf("%x", sum)
		}
	}

	//hash email ('em') if only it isn't hashed yet
	email, ok := userData["em"]
	if ok {
		strEmail := fmt.Sprintf("%v", email)
		if strings.Contains(strEmail, "@") || strEmail == events.MaskedParameterValue {
			sum := sha256.Sum256([]byte(strEmail))
			userData["em"] = fmt.Sprintf("%x", sum)
		}
	}
}

func (frf *FacebookRequestFactory) Close() {
}
