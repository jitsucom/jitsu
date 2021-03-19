package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	fb "github.com/huandu/facebook/v2"
	"github.com/jitsucom/eventnative/server/logging"
	"github.com/jitsucom/eventnative/server/typing"
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
	adsCollection      = "ads"
	fbMaxAttempts      = 2
)

type FacebookMarketing struct {
	collection   *Collection
	config       *FacebookMarketingConfig
	reportConfig *FacebookReportConfig
}

type FacebookReportConfig struct {
	Fields []string `mapstructure:"fields" json:"fields,omitempty" yaml:"fields,omitempty"`
	Level  string   `mapstructure:"level" json:"level,omitempty" yaml:"level,omitempty"`
}

type FacebookMarketingConfig struct {
	AccountId   string `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	AccessToken string `mapstructure:"access_token" json:"access_token,omitempty" yaml:"access_token,omitempty"`
}

func (fmc *FacebookMarketingConfig) Validate() error {
	if fmc.AccountId == "" {
		return errors.New("account_id is required")
	}
	if fmc.AccessToken == "" {
		return errors.New("access_token is required")
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
	reportConfig := &FacebookReportConfig{}
	if err := unmarshalConfig(collection.Parameters, reportConfig); err != nil {
		return nil, err
	}
	if reportConfig.Level == "" {
		reportConfig.Level = "ad"

		logging.Warnf("[%s_%s] parameters.level wasn't provided. Will be used default one: %s", sourceConfig.Name, collection.Name, reportConfig.Level)
	}

	if collection.Type != adsCollection && collection.Type != insightsCollection {
		return nil, fmt.Errorf("Unknown collection [%s]: Only [%s] and [%s] are supported now", collection.Type, adsCollection, insightsCollection)
	}
	return &FacebookMarketing{collection: collection, config: config, reportConfig: reportConfig}, nil
}

func init() {
	if err := RegisterDriverConstructor(fbMarketingType, NewFacebookMarketing); err != nil {
		logging.Errorf("Failed to register driver %s: %v", fbMarketingType, err)
	}
}

//GetAllAvailableIntervals return half a year by default
func (fm *FacebookMarketing) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	if fm.collection.Type == adsCollection {
		return []*TimeInterval{NewTimeInterval(ALL, time.Time{})}, nil
	}

	//insights
	var intervals []*TimeInterval
	daysBackToLoad := defaultDaysBackToLoad
	if fm.collection.DaysBackToLoad > 0 {
		daysBackToLoad = fm.collection.DaysBackToLoad
	}

	now := time.Now().UTC()
	for i := 0; i < daysBackToLoad; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, NewTimeInterval(DAY, date))
	}
	return intervals, nil
}

func (fm *FacebookMarketing) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	switch fm.collection.Type {
	case adsCollection:
		return fm.syncAdsReport(interval)
	case insightsCollection:
		return fm.syncInsightsReport(interval)
	default:
		return nil, fmt.Errorf("Error syncing collection type [%s]. Only [%s] and [%s] are supported now", fm.collection.Type, adsCollection, insightsCollection)
	}
}

func (fm *FacebookMarketing) syncInsightsReport(interval *TimeInterval) ([]map[string]interface{}, error) {
	rows, err := fm.loadReportWithRetry("/v9.0/act_"+fm.config.AccountId+"/insights", fm.reportConfig.Fields, interval, 0)
	if err != nil {
		return nil, err
	}

	logging.Debugf("[%s] Rows to sync: %d", interval.String(), len(rows))
	return rows, nil
}

func (fm *FacebookMarketing) syncAdsReport(interval *TimeInterval) ([]map[string]interface{}, error) {
	rows, err := fm.loadReportWithRetry("/v9.0/act_"+fm.config.AccountId+"/ads", fm.reportConfig.Fields, nil, 200)
	if err != nil {
		return nil, err
	}

	logging.Debugf("[%s] Rows to sync: %d", interval.String(), len(rows))
	return rows, nil
}

func (fm *FacebookMarketing) buildTimeInterval(interval *TimeInterval) string {
	dayStart := interval.LowerEndpoint()
	since := DAY.Format(dayStart)
	until := DAY.Format(dayStart.AddDate(0, 0, 1))
	return fmt.Sprintf("{'since': '%s', 'until': '%s'}", since, until)
}

func (fm *FacebookMarketing) loadReportWithRetry(url string, fields []string, interval *TimeInterval, pageLimit int) ([]map[string]interface{}, error) {
	requestParameters := fb.Params{
		"level":        fm.reportConfig.Level,
		"fields":       strings.Join(fields, ","),
		"access_token": fm.config.AccessToken,
	}

	if interval != nil {
		requestParameters["time_range"] = fm.buildTimeInterval(interval)
	}

	if pageLimit > 0 {
		requestParameters["limit"] = pageLimit
	}

	attempt := 0
	var response fb.Result
	var err error
	for attempt < fbMaxAttempts {
		response, err = fb.Get(url, requestParameters)
		if err == nil {
			fm.logUsage(response.UsageInfo())

			data, err := fm.parseData(response)
			if err != nil {
				return nil, err
			}

			//typecasts
			for _, row := range data {
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

			return data, nil
		}

		if fbErr, ok := err.(*fb.Error); ok {
			if fbErr.Code == 80000 {
				logging.Debugf("Facebook account: [%s] rate-limiting error: %v. Will be retry after 1 minute", fm.config.AccountId, err)

				//rate limiting
				time.Sleep(time.Duration(1) * time.Minute)
				attempt++
				continue
			}
		}

		logging.Debugf("Facebook account: [%s] error: %v. Will be retry after 1 second", fm.config.AccountId, err)
		time.Sleep(time.Duration(attempt+1) * time.Second)
		attempt++
	}

	return nil, err
}

//parseData read all data (if paging) and return result
func (fm *FacebookMarketing) parseData(response fb.Result) ([]map[string]interface{}, error) {
	session := &fb.Session{
		Version: "v9.0",
	}
	paging, err := response.Paging(session)
	if err != nil {
		return nil, fmt.Errorf("Error getting Facebook page: %v", err)
	}

	var allResults []map[string]interface{}
	// append first page of results to slice of Result
	for _, row := range paging.Data() {
		allResults = append(allResults, row)
	}

	for paging.HasNext() {
		// get next page.
		_, err := paging.Next()
		if err != nil {
			return nil, fmt.Errorf("Error reading Facebook page: %v", err)
		}

		fm.logUsage(paging.UsageInfo())

		// append current page of results to slice of Result
		for _, row := range paging.Data() {
			allResults = append(allResults, row)
		}
	}

	return allResults, nil
}

func (fm *FacebookMarketing) logUsage(usage *fb.UsageInfo) {
	if usage != nil {
		b, _ := json.Marshal(usage)
		logging.Debugf("Facebook account %s usage: %s", fm.config.AccountId, string(b))
	}
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
