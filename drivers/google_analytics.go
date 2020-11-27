package drivers

import (
	"context"
	"encoding/json"
	"fmt"
	ga "google.golang.org/api/analyticsreporting/v4"
	"google.golang.org/api/option"
	"strings"
	"time"
)

type GoogleAnalyticsConfig struct {
	ClientId     string   `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string   `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string   `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	ReportFields []string `mapstructure:"report_fields" json:"report_fields,omitempty" yaml:"report_fields,omitempty"`
	ViewId       string   `mapstructure:"view_id" json:"view_id,omitempty" yaml:"view_id,omitempty"`
}

const dayLayout = "2006-01-01"

func (gac *GoogleAnalyticsConfig) Validate() error {
	if gac.ClientId == "" {
		return gac.emptyFieldError("Client Id")
	}
	if gac.ClientSecret == "" {
		return gac.emptyFieldError("Client secret")
	}
	if gac.RefreshToken == "" {
		return gac.emptyFieldError("Refresh token")
	}
	if gac.AuthType != "authorized_user" {
		return fmt.Errorf("Only authorized_user type is allowed")
	}
	return nil
}

func (gac *GoogleAnalyticsConfig) emptyFieldError(fieldName string) error {
	return fmt.Errorf("%s must not be empty", fieldName)
}

type GoogleAnalytics struct {
	ctx     context.Context
	config  *GoogleAnalyticsConfig
	service *ga.Service

	collection string
}

func NewGoogleAnalytics(ctx context.Context, config *GoogleAnalyticsConfig, collection string) (*GoogleAnalytics, error) {
	credentialsJSON, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	service, err := ga.NewService(ctx, option.WithCredentialsJSON(credentialsJSON))
	return &GoogleAnalytics{ctx: ctx, config: config, collection: collection, service: service}, nil
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
	dateRanges := []*ga.DateRange{
		{StartDate: interval.LowerEndpoint().Format(dayLayout),
			EndDate: interval.UpperEndpoint().Format(dayLayout)},
	}
	if g.collection == "report" {
		return g.loadReport(g.config.ViewId, dateRanges, g.config.ReportFields)
	} else if g.collection == "users_activity" {
		return nil, nil
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

func (g *GoogleAnalytics) loadReport(viewId string, dateRanges []*ga.DateRange, reportFields []string) ([]map[string]interface{}, error) {
	var metrics []*ga.Metric
	var dimensions []*ga.Dimension
	for _, field := range reportFields {
		if strings.HasPrefix(field, "metric:") {
			metrics = append(metrics, &ga.Metric{Expression: "ga:" + strings.TrimPrefix(field, "metric:")})
		} else if strings.HasPrefix(field, "dimension:") {
			dimensions = append(dimensions, &ga.Dimension{Name: "ga:" + strings.TrimPrefix(field, "dimension:")})
		} else {
			return nil, fmt.Errorf("Unknown report field %s. Should have 'metrics:' or 'dimensions:' prefix", field)
		}
	}

	req := &ga.GetReportsRequest{
		ReportRequests: []*ga.ReportRequest{
			{
				ViewId:     viewId,
				DateRanges: dateRanges,
				Metrics:    metrics,
				Dimensions: dimensions,
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

		if rows == nil {
			continue
		}
		for _, row := range rows {
			gaEvent := make(map[string]interface{})
			dims := row.Dimensions
			metrics := row.Metrics

			for i := 0; i < len(dimHeaders) && i < len(dims); i++ {
				gaEvent[dimHeaders[i]] = dims[i]
			}
			for _, metric := range metrics {
				for j := 0; j < len(metricHeaders) && j < len(metric.Values); j++ {
					gaEvent[metricHeaders[j].Name] = metric.Values[j]
				}
			}
			result = append(result, gaEvent)
		}
	}
	return result, nil
}
