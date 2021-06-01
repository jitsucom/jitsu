package adapters

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
)

const defaultEventType = "event"

var (
	gaEventTypeMapping = map[string]string{
		"pageview":    "pageview",
		"screenview":  "screenview",
		"event":       "event",
		"conversion":  "transaction",
		"transaction": "transaction",
		"item":        "item",
		"social":      "social",
		"exception":   "exception",
		"timing":      "timing",
	}
)

//GoogleAnalyticsConfig is a GA configuration
type GoogleAnalyticsConfig struct {
	TrackingID string `mapstructure:"tracking_id" json:"tracking_id,omitempty" yaml:"tracking_id,omitempty"`
}

//Validate returns true if some fields are empty
func (gac *GoogleAnalyticsConfig) Validate() error {
	if gac == nil {
		return errors.New("google_analytics config is required")
	}
	if gac.TrackingID == "" {
		return errors.New("tracking_id is required parameter")
	}

	return nil
}

//GoogleAnalyticsRequestFactory is a HTTPRequestFactory for GA
type GoogleAnalyticsRequestFactory struct {
	config *GoogleAnalyticsConfig
}

//Create returns HTTP GET request with query parameters
//removes system fields and map event type
func (garf *GoogleAnalyticsRequestFactory) Create(object map[string]interface{}) (*Request, error) {
	uv := make(url.Values)
	uv.Add("tid", garf.config.TrackingID)
	uv.Add("v", "1")

	for k, v := range object {
		strValue, ok := v.(string)
		if !ok {
			strValue = fmt.Sprint(v)
		}

		//override event type
		if k == "t" {
			mapped, ok := gaEventTypeMapping[strValue]
			if !ok {
				mapped = defaultEventType
			}

			strValue = mapped
		}

		uv.Add(k, strValue)
	}

	reqURL := "https://www.google-analytics.com/collect?" + uv.Encode()

	return &Request{
		URL:     reqURL,
		Method:  http.MethodGet,
		Body:    nil,
		Headers: map[string]string{},
	}, nil
}

//GoogleAnalytics is an adapter for sending events into GoogleAnalytics
type GoogleAnalytics struct {
	httpAdapter *HTTPAdapter
}

//NewGoogleAnalytics returns configured GoogleAnalytics instance
func NewGoogleAnalytics(config *GoogleAnalyticsConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*GoogleAnalytics, error) {
	httpAdapterConfiguration.HTTPReqFactory = &GoogleAnalyticsRequestFactory{config: config}

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	return &GoogleAnalytics{httpAdapter: httpAdapter}, nil
}

//Insert passes object to HTTPAdapter
func (ga *GoogleAnalytics) Insert(eventContext *EventContext) error {
	return ga.httpAdapter.SendAsync(eventContext)
}

//GetTableSchema always return empty schema
func (ga *GoogleAnalytics) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

func (ga *GoogleAnalytics) CreateDB(databaseName string) error {
	return fmt.Errorf("NOT IMPLEMENTED")
}

//CreateTable GA doesn't use tables
func (ga *GoogleAnalytics) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema GA doesn't use tables
func (ga *GoogleAnalytics) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (ga *GoogleAnalytics) BulkInsert(table *Table, objects []map[string]interface{}) error {
	return fmt.Errorf("NOT IMPLEMENTED")
}

func (ga *GoogleAnalytics) BulkUpdate(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) error {
	return fmt.Errorf("NOT IMPLEMENTED")
}

//Close closes HTTPAdapter
func (ga *GoogleAnalytics) Close() error {
	return ga.httpAdapter.Close()
}
