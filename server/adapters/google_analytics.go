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

//NewGoogleAnalyticsRequestFactory returns configured factory instance
func NewGoogleAnalyticsRequestFactory(config *GoogleAnalyticsConfig) *GoogleAnalyticsRequestFactory {
	return &GoogleAnalyticsRequestFactory{config: config}
}

//Create returns HTTP GET request with query parameters
//removes system fields and map event type
func (garf *GoogleAnalyticsRequestFactory) Create(object map[string]interface{}) (*http.Request, error) {
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

	return http.NewRequest(http.MethodGet, reqURL, nil)
}

//GoogleAnalytics is an adapter for sending events into GoogleAnalytics
type GoogleAnalytics struct {
	httpAdapter *HTTPAdapter
}

//NewGoogleAnalytics returns configured GoogleAnalytics instance
func NewGoogleAnalytics(adapter *HTTPAdapter) *GoogleAnalytics {
	return &GoogleAnalytics{httpAdapter: adapter}
}

//Send passes object to HTTPAdapter
func (ga *GoogleAnalytics) Send(object map[string]interface{}) error {
	return ga.httpAdapter.SendAsync(object)
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

//CreateTable GA doesn't use tables
func (ga *GoogleAnalytics) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema GA doesn't use tables
func (ga *GoogleAnalytics) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

//Close closes HTTPAdapter
func (ga *GoogleAnalytics) Close() error {
	return ga.httpAdapter.Close()
}
