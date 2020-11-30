package drivers

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	ga "google.golang.org/api/analyticsreporting/v4"
	"google.golang.org/api/option"
	"strings"
	"time"
)

const (
	dayLayout               = "2006-01-02"
	reportsCollection       = "report"
	usersActivityCollection = "users_activity"
	gaFieldsPrefix          = "ga:"
)

type GoogleAnalyticsConfig struct {
	AuthConfig   *GoogleAuthConfig   `mapstructure:"auth" json:"auth,omitempty" yaml:"auth,omitempty"`
	ViewId       string              `mapstructure:"view_id" json:"view_id,omitempty" yaml:"view_id,omitempty"`
	ReportFields *ReportFieldsConfig `mapstructure:"report_fields" json:"report_fields,omitempty" yaml:"report_fields,omitempty"`
}

type ReportFieldsConfig struct {
	Dimensions []string `mapstructure:"dimensions" json:"dimensions,omitempty" yaml:"dimensions,omitempty"`
	Metrics    []string `mapstructure:"metrics" json:"metrics,omitempty" yaml:"metrics,omitempty"`
}

type GoogleAuthConfig struct {
	ClientId     string                 `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string                 `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string                 `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AccountKey   map[string]interface{} `mapstructure:"account_key" json:"account_key,omitempty" yaml:"account_key,omitempty"`
}

type GoogleAuthorizedUserJSON struct {
	ClientId     string `mapstructure:"client_id" json:"client_id,omitempty" yaml:"client_id,omitempty"`
	ClientSecret string `mapstructure:"client_secret" json:"client_secret,omitempty" yaml:"client_secret,omitempty"`
	RefreshToken string `mapstructure:"refresh_token" json:"refresh_token,omitempty" yaml:"refresh_token,omitempty"`
	AuthType     string `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

func (gac *GoogleAuthConfig) ToGoogleAuthJSON() GoogleAuthorizedUserJSON {
	return GoogleAuthorizedUserJSON{ClientId: gac.ClientId, ClientSecret: gac.ClientSecret,
		RefreshToken: gac.RefreshToken, AuthType: "authorized_user"}
}

func (gac *GoogleAnalyticsConfig) Validate() error {
	if gac.ViewId == "" {
		return gac.emptyFieldError("view_id")
	}
	//if gac.AuthConfig.ClientId == "" {
	//	return gac.emptyFieldError("auth.client_id")
	//}
	//if gac.AuthConfig.ClientSecret == "" {
	//	return gac.emptyFieldError("auth.client_secret")
	//}
	//if gac.AuthConfig.RefreshToken == "" {
	//	return gac.emptyFieldError("auth.refresh_token")
	//}
	return nil
}

func (gac *GoogleAnalyticsConfig) emptyFieldError(fieldName string) error {
	return fmt.Errorf("%s must not be empty", fieldName)
}

type GoogleAnalytics struct {
	ctx        context.Context
	config     *GoogleAnalyticsConfig
	service    *ga.Service
	collection *Collection
}

func NewGoogleAnalytics(ctx context.Context, config *GoogleAnalyticsConfig, collection *Collection) (*GoogleAnalytics, error) {
	credentialsJSON, err := config.AuthConfig.resolveAuth()
	if err != nil {
		return nil, err
	}
	service, err := ga.NewService(ctx, option.WithCredentialsJSON(credentialsJSON))
	return &GoogleAnalytics{ctx: ctx, config: config, collection: collection, service: service}, nil
}

func (gac *GoogleAuthConfig) resolveAuth() ([]byte, error) {
	if gac.AccountKey != nil {
		return json.Marshal(gac.AccountKey)
	} else {
		return json.Marshal(gac.ToGoogleAuthJSON())
	}
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
		return g.loadReport(g.config.ViewId, dateRanges, g.config.ReportFields.Dimensions, g.config.ReportFields.Metrics)
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
