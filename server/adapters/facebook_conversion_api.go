package adapters

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"io/ioutil"
	"net/http"
	"strings"
	"time"
)

const eventsURLTemplate = "https://graph.facebook.com/v9.0/%s/events?access_token=%s&locale=en_EN"

var (
	//FB doesn't use types
	SchemaToFacebookConversion = map[typing.DataType]string{
		typing.STRING:    "string",
		typing.INT64:     "string",
		typing.FLOAT64:   "string",
		typing.TIMESTAMP: "string",
		typing.BOOL:      "string",
		typing.UNKNOWN:   "string",
	}

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
	PixelID     string `mapstructure:"pixel_id" json:"pixel_id,omitempty" yaml:"pixel_id,omitempty"`
	AccessToken string `mapstructure:"access_token" json:"access_token,omitempty" yaml:"access_token,omitempty"`
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

type FacebookResponse struct {
	Error FacebookResponseErr `json:"error,omitempty"`
}

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
	config      *FacebookConversionAPIConfig
	client      *http.Client
	debugLogger *logging.QueryLogger
}

//NewFacebookConversion return new instance of adapter
func NewFacebookConversion(config *FacebookConversionAPIConfig, requestDebugLogger *logging.QueryLogger) *FacebookConversionAPI {
	return &FacebookConversionAPI{
		config: config,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		debugLogger: requestDebugLogger,
	}
}

//TestAccess send test request (empty POST) to Facebook and check if pixel id or access token are invalid
func (fc *FacebookConversionAPI) TestAccess() error {
	reqURL := fmt.Sprintf(eventsURLTemplate, fc.config.PixelID, fc.config.AccessToken)
	reqBody := &FacebookConversionEventsReq{}

	bodyPayload, _ := json.Marshal(reqBody)

	//send empty request and expect error
	r, err := fc.client.Post(reqURL, "application/json", bytes.NewBuffer(bodyPayload))
	if r != nil && r.Body != nil {
		defer r.Body.Close()

		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("Error reading facebook conversion API response body: %v", err)
		}

		response := &FacebookResponse{}
		err = json.Unmarshal(responseBody, response)
		if err != nil {
			return fmt.Errorf("Error unmarhalling facebook conversion API response body: %v", err)
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

//Send HTTP POST request to Facebook Conversion API
//transform parameters (event_time -> unix timestamp)
//map input event_type(event_name) with standard
//hash fields according to documentation
func (fc *FacebookConversionAPI) Send(object map[string]interface{}) error {
	// ** Parameters transformation **
	// * action_source
	_, ok := object["action_source"]
	if !ok {
		object["action_source"] = "website"
	}

	// * event_time
	fc.enrichWithEventTime(object)

	// * event_name
	eventName, ok := object["event_name"]
	if !ok {
		return fmt.Errorf("Object doesn't have event_name")
	}

	eventNameStr, ok := eventName.(string)
	if !ok {
		return fmt.Errorf("event_name must be string: %T", eventName)
	}

	mappedEventName, ok := fbEventTypeMapping[eventNameStr]
	if ok {
		object["event_name"] = mappedEventName
	}

	fc.hashFields(object)

	//* test_event_code
	var testEventCodeStr string
	testEventCode, testEventCodeExists := object["test_event_code"]
	if testEventCodeExists {
		delete(object, "test_event_code")
		testEventCodeStr = fmt.Sprint(testEventCode)
	}

	//sending
	var responsePayload string

	reqURL := fmt.Sprintf(eventsURLTemplate, fc.config.PixelID, fc.config.AccessToken)
	reqBody := &FacebookConversionEventsReq{Data: []map[string]interface{}{object}, TestEventCode: testEventCodeStr}

	bodyPayload, _ := json.Marshal(reqBody)

	fc.debugLogger.LogQueryWithValues("POST "+reqURL, []interface{}{string(bodyPayload)})

	r, err := fc.client.Post(reqURL, "application/json", bytes.NewBuffer(bodyPayload))
	if r != nil && r.Body != nil {
		defer r.Body.Close()

		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("Error reading facebook conversion API response body: %v", err)
		}

		responsePayload = string(responseBody)
	}

	if err != nil {
		return err
	}

	if r.StatusCode != http.StatusOK {
		return fmt.Errorf("Facebook Conversion API response code: %d body: %s", r.StatusCode, responsePayload)
	}

	return nil
}

//GetTableSchema always return empty schema
func (fc *FacebookConversionAPI) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable Facebook doesn't use tables
func (fc *FacebookConversionAPI) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema Facebook doesn't use tables
func (fc *FacebookConversionAPI) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (fc *FacebookConversionAPI) Close() error {
	fc.client.CloseIdleConnections()

	return nil
}

func (fc *FacebookConversionAPI) enrichWithEventTime(object map[string]interface{}) {
	eventTime := time.Now().UTC()
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
func (fc *FacebookConversionAPI) hashFields(object map[string]interface{}) {
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
		if strings.Contains(strEmail, "@") {
			sum := sha256.Sum256([]byte(strEmail))
			userData["em"] = fmt.Sprintf("%x", sum)
		}
	}
}
