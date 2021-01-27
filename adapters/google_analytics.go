package adapters

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	"net/http"
	"net/url"
	"time"
)

const defaultEventType = "event"

var (
	//GA doesn't use types
	SchemaToGoogleAnalytics = map[typing.DataType]string{
		typing.STRING:    "string",
		typing.INT64:     "string",
		typing.FLOAT64:   "string",
		typing.TIMESTAMP: "string",
		typing.BOOL:      "string",
		typing.UNKNOWN:   "string",
	}

	eventTypeMapping = map[string]string{
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

type GoogleAnalyticsConfig struct {
	TrackingId string `mapstructure:"tracking_id" json:"tracking_id,omitempty" yaml:"tracking_id,omitempty"`
}

func (gac GoogleAnalyticsConfig) Validate() error {
	if gac.TrackingId == "" {
		return errors.New("tracking_id is required parameter")
	}

	return nil
}

type GoogleAnalytics struct {
	config      *GoogleAnalyticsConfig
	client      *http.Client
	debugLogger *logging.QueryLogger
}

func NewGoogleAnalytics(config *GoogleAnalyticsConfig, requestDebugLogger *logging.QueryLogger) *GoogleAnalytics {
	return &GoogleAnalytics{
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

//Send HTTP GET request to GoogleAnalytics with query parameters
//remove system fields and map event type
func (ga GoogleAnalytics) Send(object map[string]interface{}) error {
	uv := make(url.Values)
	uv.Add("tid", ga.config.TrackingId)
	uv.Add("v", "1")

	//remove system fields
	for _, systemField := range schema.SystemFields {
		delete(object, systemField)
	}

	for k, v := range object {
		strValue, ok := v.(string)
		if !ok {
			strValue = fmt.Sprint(v)
		}

		//override event type
		if k == "t" {
			mapped, ok := eventTypeMapping[strValue]
			if !ok {
				mapped = defaultEventType
			}

			strValue = mapped
		}

		uv.Add(k, strValue)
	}

	reqUrl := "https://www.google-analytics.com/collect?" + uv.Encode()
	ga.debugLogger.LogQuery(reqUrl)

	r, err := ga.client.Get(reqUrl)
	if r != nil && r.Body != nil {
		r.Body.Close()
	}

	if err != nil {
		return err
	}

	if r.StatusCode != http.StatusOK {
		return fmt.Errorf("Google Analytics response code: %d", r.StatusCode)
	}

	return nil
}

//GetTableSchema always return empty schema
func (ga GoogleAnalytics) GetTableSchema(tableName string) (*Table, error) {
	return &Table{
		Name:           tableName,
		Columns:        Columns{},
		PKFields:       map[string]bool{},
		DeletePkFields: false,
		Version:        0,
	}, nil
}

//CreateTable GA doesn't use tables
func (ga GoogleAnalytics) CreateTable(schemaToCreate *Table) error {
	return nil
}

//PatchTableSchema GA doesn't use tables
func (ga GoogleAnalytics) PatchTableSchema(schemaToAdd *Table) error {
	return nil
}

func (ga GoogleAnalytics) Close() error {
	ga.client.CloseIdleConnections()

	return nil
}
