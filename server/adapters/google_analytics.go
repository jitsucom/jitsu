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

func (garf *GoogleAnalyticsRequestFactory) Close()  {
}

//GoogleAnalytics is an adapter for sending events into GoogleAnalytics
type GoogleAnalytics struct {
	AbstractHTTP
}

//NewGoogleAnalytics returns configured GoogleAnalytics instance
func NewGoogleAnalytics(config *GoogleAnalyticsConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*GoogleAnalytics, error) {
	httpAdapterConfiguration.HTTPReqFactory = &GoogleAnalyticsRequestFactory{config: config}

	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	ga := &GoogleAnalytics{}
	ga.httpAdapter = httpAdapter
	return ga, nil
}

//Type returns adapter type
func (ga *GoogleAnalytics) Type() string {
	return "GoogleAnalytics"
}
