package drivers

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	ga "google.golang.org/api/analyticsreporting/v4"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	dayLayout         = "2006-01-02"
	reportsCollection = "report"
	gaFieldsPrefix    = "ga:"
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

func (gac *GoogleAnalyticsConfig) authorizationConfigurationError() error {
	return fmt.Errorf("authorization is not configured. You need to configure [service_account_key] field or " +
		"[client_id, client_secret, refresh_token] set of fields")
}

type GoogleAnalytics struct {
	ctx                context.Context
	config             *GoogleAnalyticsConfig
	service            *ga.Service
	collection         *Collection
	reportFieldsConfig *ReportFieldsConfig
}

func NewGoogleAnalytics(ctx context.Context, config *GoogleAnalyticsConfig, collection *Collection) (*GoogleAnalytics, error) {
	var reportFieldsConfig ReportFieldsConfig
	err := unmarshalConfig(collection.Parameters, &reportFieldsConfig)
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
	return &GoogleAnalytics{ctx: ctx, config: config, collection: collection, service: service,
		reportFieldsConfig: &reportFieldsConfig}, nil
}

func (g *GoogleAnalytics) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	var intervals []*TimeInterval
	now := time.Now()
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

	if g.collection.Name == reportsCollection {
		return g.loadReport(g.config.ViewId, dateRanges, g.reportFieldsConfig.Dimensions, g.reportFieldsConfig.Metrics)
	} else {
		return nil, fmt.Errorf("Unknown collection %s: only 'report' and 'users_activity' are supported", g.collection)
	}
}

func (g *GoogleAnalytics) Type() string {
	return GoogleAnalyticsType
}

func (g *GoogleAnalytics) Close() error {
	return nil
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
		if rows == nil {
			continue
		}
		for _, row := range rows {
			gaEvent := make(map[string]interface{})
			dims := row.Dimensions
			metrics := row.Metrics

			for i := 0; i < len(dimHeaders) && i < len(dims); i++ {
				gaEvent[strings.TrimPrefix(dimHeaders[i], gaFieldsPrefix)] = dims[i]
			}
			for _, metric := range metrics {
				for j := 0; j < len(metricHeaders) && j < len(metric.Values); j++ {
					gaEvent[strings.TrimPrefix(metricHeaders[j].Name, gaFieldsPrefix)] = metric.Values[j]
				}
			}
			result = append(result, gaEvent)
		}
	}
	return result, nil
}
