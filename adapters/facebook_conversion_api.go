package adapters

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/typing"
	"io/ioutil"
	"net/http"
	"strings"
	"time"
)

const eventsUrlTemplate = "https://graph.facebook.com/v9.0/%s/events?access_token=%s&locale=en_EN"

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
		"conversion": "Purchase",
	}

	fieldsToHash = []string{"ph", "ge", "db", "ln", "fn", "ct", "st", "zp", "country"}
)

//FacebookConversionAPIConfig dto for deserialized datasource config (e.g. in Facebook destination)
type FacebookConversionAPIConfig struct {
	PixelId     string `mapstructure:"pixel_id" json:"pixel_id,omitempty" yaml:"pixel_id,omitempty"`
	AccessToken string `mapstructure:"access_token" json:"access_token,omitempty" yaml:"access_token,omitempty"`
}

//Validate required fields in FacebookConversionAPIConfig
func (fmc FacebookConversionAPIConfig) Validate() error {
	if fmc.PixelId == "" {
		return errors.New("pixel_id is required parameter")
	}

	if fmc.AccessToken == "" {
		return errors.New("access_token is required parameter")
	}

	return nil
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

//Send HTTP POST request to Facebook Conversion API
//transform parameters
//map event_name
func (fc *FacebookConversionAPI) Send(object map[string]interface{}) error {
	// ** Parameters transformation **
	// * event_time
	t, ok := object[timestamp.Key]
	if !ok {
		return fmt.Errorf("Object doesn't have %s system field", timestamp.Key)
	}

	eventTime, ok := t.(time.Time)
	if !ok {
		return fmt.Errorf("_timestamp must be time.Time struct: %T", t)
	}

	object["event_time"] = eventTime.Unix()

	// * remove system fields
	for _, systemField := range schema.SystemFields {
		delete(object, systemField)
	}

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
	if !ok {
		return fmt.Errorf("event_name mapping not found for event name: %s. Mappings: %v", eventNameStr, fbEventTypeMapping)
	}
	object["event_name"] = mappedEventName

	fc.hashFields(object)

	//* test_event_code
	testEventCode, testEventCodeExists := object["test_event_code"]
	if testEventCodeExists {
		delete(object, "test_event_code")
	}

	//sending
	var responsePayload string

	reqUrl := fmt.Sprintf(eventsUrlTemplate, fc.config.PixelId, fc.config.AccessToken)
	reqBody := &FacebookConversionEventsReq{Data: []map[string]interface{}{object}, TestEventCode: fmt.Sprint(testEventCode)}

	bodyPayload, _ := json.Marshal(reqBody)

	fc.debugLogger.LogQueryWithValues("POST "+reqUrl, []interface{}{string(bodyPayload)})

	r, err := fc.client.Post(reqUrl, "application/json", bytes.NewBuffer(bodyPayload))
	if r != nil && r.Body != nil {
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
