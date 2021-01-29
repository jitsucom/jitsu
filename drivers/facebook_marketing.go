package drivers

import (
	"context"
	"errors"
	"fmt"
	fb "github.com/huandu/facebook/v2"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/typing"
	"strings"
	"time"
)

var (
	castMapping = map[string]func(interface{}) (interface{}, error){
		"clicks":                    typing.StringToInt,
		"impressions":               typing.StringToInt,
		"reach":                     typing.StringToInt,
		"full_view_reach":           typing.StringToInt,
		"full_view_impressions":     typing.StringToInt,
		"unique_clicks":             typing.StringToInt,
		"unique_inline_link_clicks": typing.StringToInt,

		"cpc":                          typing.StringToFloat,
		"cpm":                          typing.StringToFloat,
		"cpp":                          typing.StringToFloat,
		"ctr":                          typing.StringToFloat,
		"frequency":                    typing.StringToFloat,
		"unique_ctr":                   typing.StringToFloat,
		"spend":                        typing.StringToFloat,
		"social_spend":                 typing.StringToFloat,
		"unique_inline_link_click_ctr": typing.StringToFloat,
		"unique_link_clicks_ctr":       typing.StringToFloat,
	}
)

const (
	fbMarketingType    = "facebook_marketing"
	insightsCollection = "insights"
	fbMaxAttempts      = 3
)

type FacebookMarketingConfig struct {
	AccountId string `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	Token     string `mapstructure:"token" json:"token,omitempty" yaml:"token,omitempty"`
}

type FacebookMarketing struct {
	collection *Collection
	config     *FacebookMarketingConfig
	fields     *FacebookReportConfig
}

type FacebookReportConfig struct {
	Keys    []string `mapstructure:"keys" json:"keys,omitempty" yaml:"keys,omitempty"`
	Metrics []string `mapstructure:"metrics" json:"metrics,omitempty" yaml:"metrics,omitempty"`
	Level   string   `mapstructure:"level" json:"level,omitempty" yaml:"level,omitempty"`
}

type FacebookInsightsResponse struct {
	Data []map[string]interface{} `facebook:"data"`
}

func (fmc *FacebookMarketingConfig) Validate() error {
	if fmc.AccountId == "" {
		return errors.New("[account_id] is not configured")
	}
	if fmc.Token == "" {
		return errors.New("[token] is not configured")
	}
	return nil
}

func NewFacebookMarketing(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &FacebookMarketingConfig{}
	if err := unmarshalConfig(sourceConfig.Config, config); err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	var fields FacebookReportConfig
	if err := unmarshalConfig(collection.Parameters, &fields); err != nil {
		return nil, err
	}
	if fields.Level == "" {
		fields.Level = "ad"
	}
	return &FacebookMarketing{collection: collection, config: config, fields: &fields}, nil
}

func init() {
	if err := RegisterDriverConstructor(fbMarketingType, NewFacebookMarketing); err != nil {
		logging.Errorf("Failed to register driver %s: %v", fbMarketingType, err)
	}
}

func (fm *FacebookMarketing) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	var intervals []*TimeInterval
	now := time.Now().UTC()
	for i := 0; i < 365; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, NewTimeInterval(DAY, date))
	}
	return intervals, nil
}

func (fm *FacebookMarketing) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	if fm.collection.Type == insightsCollection {
		return fm.syncInsightsReport(interval)
	} else {
		return nil, fmt.Errorf("Error syncing collection type [%s]. Only %s is supported now", fm.collection.Type, insightsCollection)
	}
}

func (fm *FacebookMarketing) syncInsightsReport(interval *TimeInterval) ([]map[string]interface{}, error) {
	var fields []string
	fields = append(fields, fm.fields.Keys...)
	fields = append(fields, fm.fields.Metrics...)
	requestParameters := fb.Params{
		"level":        fm.fields.Level,
		"fields":       strings.Join(fields, ","),
		"access_token": fm.config.Token,
		"time_range":   fm.buildTimeInterval(interval),
	}
	response, err := fm.requestReportWithRetry("/v9.0/act_"+fm.config.AccountId+"/insights", requestParameters, fields, interval)
	if err != nil {
		return nil, err
	}
	var result FacebookInsightsResponse
	if err := response.Decode(&result); err != nil {
		return nil, err
	}
	for _, row := range result.Data {
		for fieldName, stringValue := range row {
			convertFunc, ok := castMapping[fieldName]
			if ok {
				convertedValue, err := convertFunc(stringValue)
				if err != nil {
					return nil, err
				}
				row[fieldName] = convertedValue
			}
		}
	}
	logging.Debugf("[%s] Rows to sync: %d", interval.String(), len(result.Data))
	return result.Data, nil
}

func (fm *FacebookMarketing) buildTimeInterval(interval *TimeInterval) string {
	dayStart := interval.LowerEndpoint()
	since := DAY.Format(dayStart)
	until := DAY.Format(dayStart.AddDate(0, 0, 1))
	return fmt.Sprintf("{'since': '%s', 'until': '%s'}", since, until)
}

func (fm *FacebookMarketing) requestReportWithRetry(url string, requestParameters fb.Params, fields []string, interval *TimeInterval) (fb.Result, error) {
	attempt := 0
	var response fb.Result
	var err error
	for attempt < fbMaxAttempts {
		response, err = fb.Get(url, requestParameters)
		if err == nil {
			return response, nil
		}
		time.Sleep(time.Duration(attempt+1) * time.Second)
		attempt++
	}
	return nil, err
}

func (fm *FacebookMarketing) Type() string {
	return fbMarketingType
}

func (fm *FacebookMarketing) GetCollectionTable() string {
	return fm.collection.GetTableName()
}

func (fm *FacebookMarketing) Close() error {
	return nil
}
