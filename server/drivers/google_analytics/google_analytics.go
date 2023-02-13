package google_analytics

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	ga "google.golang.org/api/analyticsreporting/v4"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	dayLayout         = "2006-01-02"
	ReportsCollection = "report"
	gaFieldsPrefix    = "ga:"
	eventID           = "event_id"

	gaMaxAttempts = 3 // sometimes Google API returns errors for unknown reasons, this is a number of retries we make before fail to get a report
)

var (
	metricsCast = map[string]func(interface{}) (interface{}, error){
		"ga:1dayUsers":        typing.StringToInt,
		"ga:7dayUsers":        typing.StringToInt,
		"ga:14dayUsers":       typing.StringToInt,
		"ga:28dayUsers":       typing.StringToInt,
		"ga:30dayUsers":       typing.StringToInt,
		"ga:sessions":         typing.StringToInt,
		"ga:users":            typing.StringToInt,
		"ga:hits":             typing.StringToInt,
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
		"ga:transactions":     typing.StringToInt,

		"ga:adCost":             typing.StringToFloat,
		"ga:avgSessionDuration": typing.StringToFloat,
		"ga:timeOnPage":         typing.StringToFloat,
		"ga:avgTimeOnPage":      typing.StringToFloat,
		"ga:transactionRevenue": typing.StringToFloat,
	}
)

type GoogleAnalytics struct {
	base.IntervalDriver

	ctx                context.Context
	config             *GoogleAnalyticsConfig
	service            *ga.Service
	collection         *base.Collection
	reportFieldsConfig *GAReportFieldsConfig
}

func init() {
	base.RegisterDriver(base.GoogleAnalyticsType, NewGoogleAnalytics)
	base.RegisterTestConnectionFunc(base.GoogleAnalyticsType, TestGoogleAnalytics)
}

//NewGoogleAnalytics returns configured Google Analytics driver instance
func NewGoogleAnalytics(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &GoogleAnalyticsConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	config.AuthConfig.FillPreconfiguredOauth(base.GoogleAnalyticsType)
	if err := config.Validate(); err != nil {
		return nil, err
	}

	var reportFieldsConfig GAReportFieldsConfig
	err = jsonutils.UnmarshalConfig(collection.Parameters, &reportFieldsConfig)
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
	return &GoogleAnalytics{
		IntervalDriver:     base.IntervalDriver{SourceType: sourceConfig.Type},
		ctx:                ctx,
		config:             config,
		collection:         collection,
		service:            service,
		reportFieldsConfig: &reportFieldsConfig,
	}, nil
}

//TestGoogleAnalytics tests connection to Google Analytics without creating Driver instance
func TestGoogleAnalytics(sourceConfig *base.SourceConfig) error {
	config := &GoogleAnalyticsConfig{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return err
	}
	config.AuthConfig.FillPreconfiguredOauth(base.GoogleAnalyticsType)
	if err := config.Validate(); err != nil {
		return err
	}

	credentialsJSON, err := config.AuthConfig.Marshal()
	if err != nil {
		return err
	}
	service, err := ga.NewService(context.Background(), option.WithCredentialsJSON(credentialsJSON))
	if err != nil {
		return fmt.Errorf("failed to create GA service: %v", err)
	}

	now := timestamp.Now().UTC()
	startDate := now.AddDate(0, 0, -1)
	req := &ga.GetReportsRequest{
		ReportRequests: []*ga.ReportRequest{
			{
				ViewId: config.ViewID,
				DateRanges: []*ga.DateRange{
					{StartDate: startDate.Format(dayLayout),
						EndDate: now.Format(dayLayout)},
				},
				PageToken: "",
				PageSize:  1,
			},
		},
	}

	_, err = service.Reports.BatchGet(req).Do()
	return err
}

func (a *GoogleAnalytics) GetRefreshWindow() (time.Duration, error) {
	return time.Hour * 24 * 31, nil
}

func (g *GoogleAnalytics) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	var intervals []*base.TimeInterval
	daysBackToLoad := base.DefaultDaysBackToLoad
	if g.collection.DaysBackToLoad > 0 {
		daysBackToLoad = g.collection.DaysBackToLoad
	}

	now := timestamp.Now().UTC()
	for i := 0; i < daysBackToLoad; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, base.NewTimeInterval(schema.DAY, date))
	}
	return intervals, nil
}

func (g *GoogleAnalytics) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	logging.Debug("Sync time interval:", interval.String())
	dateRanges := []*ga.DateRange{
		{StartDate: interval.LowerEndpoint().Format(dayLayout),
			EndDate: interval.UpperEndpoint().Format(dayLayout)},
	}

	if g.collection.Type == ReportsCollection {
		array, err := g.loadReport(g.config.ViewID, dateRanges, g.reportFieldsConfig.Dimensions, g.reportFieldsConfig.Metrics)
		logging.Debugf("[%s] Rows to sync: %d", interval.String(), len(array))
		if err != nil {
			return err
		}
		return objectsLoader(array, 0, len(array), 0)
	}

	return fmt.Errorf("Unknown collection %s: only 'report' is supported", g.collection.Type)
}

func (g *GoogleAnalytics) Type() string {
	return base.GoogleAnalyticsType
}

func (g *GoogleAnalytics) Close() error {
	return nil
}

func (g *GoogleAnalytics) GetCollectionTable() string {
	return g.collection.GetTableName()
}

func (g *GoogleAnalytics) GetCollectionMetaKey() string {
	return g.collection.Name + "_" + g.GetCollectionTable()
}

func (g *GoogleAnalytics) loadReport(viewID string, dateRanges []*ga.DateRange, dimensions []string, metrics []string) ([]map[string]interface{}, error) {
	var gaDimensions []*ga.Dimension
	for _, dimension := range dimensions {
		gaDimensions = append(gaDimensions, &ga.Dimension{Name: dimension})
	}
	var gaMetrics []*ga.Metric
	for _, metric := range metrics {
		gaMetrics = append(gaMetrics, &ga.Metric{Expression: metric})
	}

	nextPageToken := ""
	var result []map[string]interface{}
	for {
		req := &ga.GetReportsRequest{
			ReportRequests: []*ga.ReportRequest{
				{
					ViewId:     viewID,
					DateRanges: dateRanges,
					Metrics:    gaMetrics,
					Dimensions: gaDimensions,
					PageToken:  nextPageToken,
					PageSize:   40000,
				},
			},
		}
		response, err := g.executeWithRetry(g.service.Reports.BatchGet(req))
		if err != nil {
			return nil, err
		}

		report := response.Reports[0]
		header := report.ColumnHeader
		dimHeaders := header.Dimensions
		metricHeaders := header.MetricHeader.MetricHeaderEntries
		rows := report.Data.Rows
		for _, row := range rows {
			gaEvent := make(map[string]interface{})
			dims := row.Dimensions
			for i := 0; i < len(dimHeaders) && i < len(dims); i++ {
				gaEvent[strings.TrimPrefix(dimHeaders[i], gaFieldsPrefix)] = dims[i]
			}

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
		nextPageToken = report.NextPageToken
		if nextPageToken == "" {
			break
		}
	}

	return result, nil
}

func (g *GoogleAnalytics) executeWithRetry(reportCall *ga.ReportsBatchGetCall) (*ga.GetReportsResponse, error) {
	attempt := 0
	var response *ga.GetReportsResponse
	var err error
	for attempt < gaMaxAttempts {
		response, err = reportCall.Do()
		if err == nil {
			return response, nil
		}

		time.Sleep(time.Duration(attempt+1) * time.Second)
		attempt++
	}
	return nil, err
}
