package drivers

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/typing"
	"github.com/jitsucom/eventnative/uuid"
	ga "google.golang.org/api/analyticsreporting/v4"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	dayLayout           = "2006-01-02"
	reportsCollection   = "report"
	gaFieldsPrefix      = "ga:"
	googleAnalyticsType = "google_analytics"
	eventCtx            = "eventn_ctx"
	eventId             = "event_id"
)

var (
	metricsCast = map[string]func(interface{}) (interface{}, error){
		"ga:sessions":         typing.StringToInt,
		"ga:users":            typing.StringToInt,
		"ga:visitors":         typing.StringToInt,
		"ga:bounces":          typing.StringToInt,
		"ga:goal1Completions": typing.StringToInt,
		"ga:goal2Completions": typing.StringToInt,
		"ga:goal3Completions": typing.StringToInt,
		"ga:goal4Completions": typing.StringToInt,
		"ga:adClicks":         typing.StringToInt,
		"ga:newUsers":         typing.StringToInt,
		"ga:pageviews":        typing.StringToInt,
		"ga:uniquePageviews":  typing.StringToInt,

		"ga:adCost":             typing.StringToFloat,
		"ga:avgSessionDuration": typing.StringToFloat,
		"ga:timeOnPage":         typing.StringToFloat,
		"ga:avgTimeOnPage":      typing.StringToFloat,
	}
)

type GoogleAnalyticsConfig struct {
	AuthConfig *GoogleAuthConfig `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
	ViewId     string            `mapstructure:"view_id" json:"view_id,omitempty" yaml:"view_id,omitempty"`
}

type ReportFieldsConfig struct {
	Dimensions []string `mapstructure:"dimensions" json:"dimensions,omitempty" yaml:"dimensions,omitempty"`
	Metrics    []string `mapstructure:"metrics" json:"metrics,omitempty" yaml:"metrics,omitempty"`
}

func (gac *GoogleAnalyticsConfig) Validate() error {
	if gac.ViewId == "" {
		return fmt.Errorf("view_id field must not be empty")
	}
	return gac.AuthConfig.Validate()
}

type GoogleAnalytics struct {
	ctx                context.Context
	config             *GoogleAnalyticsConfig
	service            *ga.Service
	collection         *Collection
	reportFieldsConfig *ReportFieldsConfig
}

func init() {
	if err := RegisterDriverConstructor(googleAnalyticsType, NewGoogleAnalytics); err != nil {
		logging.Errorf("Failed to register driver %s: %v", googleAnalyticsType, err)
	}
}

func NewGoogleAnalytics(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &GoogleAnalyticsConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	var reportFieldsConfig ReportFieldsConfig
	err = unmarshalConfig(collection.Parameters, &reportFieldsConfig)
	if err != nil {
		return nil, err
	}
	if len(reportFieldsConfig.Metrics) == 0 || len(reportFieldsConfig.Dimensions) == 0 {
		return nil, errors.New("metrics and dimensions must not be empty")
	}
	credentialsJSON, err := config.AuthConfig.Marshal()
	if err != nil {
		return nil, err
	}
	service, err := ga.NewService(ctx, option.WithCredentialsJSON(credentialsJSON))
	if err != nil {
		return nil, fmt.Errorf("failed to create GA service: %v", err)
	}
	return &GoogleAnalytics{ctx: ctx, config: config, collection: collection, service: service,
		reportFieldsConfig: &reportFieldsConfig}, nil
}

func (g *GoogleAnalytics) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	var intervals []*TimeInterval
	now := time.Now().UTC()
	for i := 0; i < 12; i++ {
		date := now.AddDate(0, -i, 0)
		intervals = append(intervals, NewTimeInterval(MONTH, date))
	}
	return intervals, nil
}

func (g *GoogleAnalytics) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	logging.Debug("Sync time interval:", interval.String())
	dateRanges := []*ga.DateRange{
		{StartDate: interval.LowerEndpoint().Format(dayLayout),
			EndDate: interval.UpperEndpoint().Format(dayLayout)},
	}

	if g.collection.Type == reportsCollection {
		return g.loadReport(g.config.ViewId, dateRanges, g.reportFieldsConfig.Dimensions, g.reportFieldsConfig.Metrics)
	} else {
		return nil, fmt.Errorf("Unknown collection %s: only 'report' is supported", g.collection)
	}
}

func (g *GoogleAnalytics) Type() string {
	return googleAnalyticsType
}

func (g *GoogleAnalytics) Close() error {
	return nil
}

func (g *GoogleAnalytics) GetCollectionTable() string {
	return g.collection.GetTableName()
}

func (g *GoogleAnalytics) loadReport(viewId string, dateRanges []*ga.DateRange, dimensions []string, metrics []string) ([]map[string]interface{}, error) {
	var gaDimensions []*ga.Dimension
	for _, dimension := range dimensions {
		gaDimensions = append(gaDimensions, &ga.Dimension{Name: dimension})
	}
	var gaMetrics []*ga.Metric
	for _, metric := range metrics {
		gaMetrics = append(gaMetrics, &ga.Metric{Expression: metric})
	}

	req := &ga.GetReportsRequest{
		ReportRequests: []*ga.ReportRequest{
			{
				ViewId:     viewId,
				DateRanges: dateRanges,
				Metrics:    gaMetrics,
				Dimensions: gaDimensions,
			},
		},
	}
	response, err := g.service.Reports.BatchGet(req).Do()
	if err != nil {
		return nil, err
	}
	var result []map[string]interface{}
	for _, report := range response.Reports {
		header := report.ColumnHeader
		dimHeaders := header.Dimensions
		metricHeaders := header.MetricHeader.MetricHeaderEntries
		rows := report.Data.Rows

		logging.Debug("Rows to sync:", len(rows))
		for _, row := range rows {
			gaEvent := make(map[string]interface{})
			dims := row.Dimensions
			for i := 0; i < len(dimHeaders) && i < len(dims); i++ {
				gaEvent[strings.TrimPrefix(dimHeaders[i], gaFieldsPrefix)] = dims[i]
			}
			gaEvent[eventCtx] = map[string]interface{}{eventId: uuid.GetHash(gaEvent)}
			//gaEvent[eventId] = uuid.GetHash(gaEvent)

			metrics := row.Metrics
			for _, metric := range metrics {
				for j := 0; j < len(metricHeaders) && j < len(metric.Values); j++ {
					fieldName := strings.TrimPrefix(metricHeaders[j].Name, gaFieldsPrefix)
					stringValue := metric.Values[j]
					convertFunc, ok := metricsCast[metricHeaders[j].Name]
					if ok {
						convertedValue, err := convertFunc(stringValue)
						if err != nil {
							return nil, err
						}
						gaEvent[fieldName] = convertedValue
					} else {
						gaEvent[fieldName] = stringValue
					}
				}
			}
			result = append(result, gaEvent)
		}
	}
	return result, nil
}
