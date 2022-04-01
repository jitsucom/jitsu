package google_ads

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/iancoleman/strcase"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/httputils"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/timestamp"
	"golang.org/x/oauth2/google"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	dayLayout       = "2006-01-02"
	dateLayoutFull  = "2006-01-02 15:04:05"
	serviceEndpoint = "https://googleads.googleapis.com"
)

//go:embed reports.csv
var availableReportsCsv string
var availableReports = make(map[string]bool)

//go:embed fields.csv
var fieldsCsv string
var fieldTypes = make(map[string]string)

var intervalFields = [...]GoogleAdsFieldGranularity{
	{"segments.hour", base.DAY}, //intended
	{"segments.date", base.DAY},
	{"segments.day_of_week", base.DAY},
	{"segments.week", base.WEEK},
	{"segments.month", base.MONTH},
	{"segments.month_of_year", base.MONTH},
	{"segments.quarter", base.QUARTER},
	{"segments.year", base.YEAR},
}

func init() {
	base.RegisterDriver(base.GoogleAdsType, NewGoogleAds)
	base.RegisterTestConnectionFunc(base.GoogleAdsType, TestGoogleAds)
	for _, str := range strings.Split(availableReportsCsv, "\n") {
		availableReports[strings.Split(str, ",")[0]] = true
	}
	for _, str := range strings.Split(fieldsCsv, "\n") {
		split := strings.Split(str, ",")
		fieldTypes[split[0]] = split[2]
	}
}

type GoogleAdsFieldGranularity struct {
	name        string
	granularity base.Granularity
}
type GoogleAds struct {
	base.IntervalDriver

	collection  *base.Collection
	config      *GoogleAdsConfig
	fields      []string
	httpClient  *http.Client
	granularity base.Granularity
}

//NewGoogleAds returns configured Google Ads driver instance
func NewGoogleAds(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	httpClient := &http.Client{
		Timeout: googleAdsHTTPConfiguration.GlobalClientTimeout,
		Transport: &http.Transport{
			MaxIdleConns:        googleAdsHTTPConfiguration.ClientMaxIdleConns,
			MaxIdleConnsPerHost: googleAdsHTTPConfiguration.ClientMaxIdleConnsPerHost,
		},
	}
	config := &GoogleAdsConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return nil, err
	}
	config.FillPreconfiguredOauth(base.GoogleAdsType)
	if err := config.Validate(); err != nil {
		return nil, err
	}
	reportConfig := &GoogleAdsCollectionConfig{}
	if err := jsonutils.UnmarshalConfig(collection.Parameters, reportConfig); err != nil {
		return nil, err
	}
	if len(reportConfig.Fields) == 0 {
		return nil, fmt.Errorf("No fields specified")
	}
	if collection.StartDateStr == "" && reportConfig.StartDateStr != "" {
		collection.StartDateStr = reportConfig.StartDateStr
		if err := collection.Init(); err != nil {
			return nil, err
		}
	}
	if !availableReports[collection.Type] {
		return nil, fmt.Errorf("Unknown collection [%s]", collection.Type)
	}

	fields := strings.Split(strings.ReplaceAll(reportConfig.Fields, " ", ""), ",")

	granularity := base.ALL
	//for binary search we make a sorted copy of fields
	sortedFields := make([]string, len(fields))
	copy(sortedFields, fields)
	sort.Strings(sortedFields)
	//looking for interval fields from shortest to longest to select appropriate granularity
	for _, pair := range intervalFields {
		i := sort.SearchStrings(sortedFields, pair.name)
		if i < len(sortedFields) && sortedFields[i] == pair.name {
			granularity = pair.granularity
			break
		}
	}
	return &GoogleAds{
		IntervalDriver: base.IntervalDriver{SourceType: sourceConfig.Type},
		collection:     collection,
		config:         config,
		fields:         fields,
		httpClient:     httpClient,
		granularity:    granularity,
	}, nil
}

func (g *GoogleAds) GetRefreshWindow() (time.Duration, error) {
	if g.granularity == base.ALL {
		return time.Hour * 24, nil
	} else {
		return time.Hour * 24 * 31, nil
	}
}

func (g *GoogleAds) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	if g.granularity == base.ALL {
		return []*base.TimeInterval{base.NewTimeInterval(base.ALL, time.Time{})}, nil
	}
	var intervals []*base.TimeInterval
	daysBackToLoad := base.DefaultDaysBackToLoad
	if g.collection.DaysBackToLoad > 0 {
		daysBackToLoad = g.collection.DaysBackToLoad
	}

	date := timestamp.Now().UTC()
	backDay := date.Truncate(time.Hour*24).AddDate(0, 0, -daysBackToLoad)
	for date.Unix() >= backDay.Unix() {
		interval := base.NewTimeInterval(g.granularity, date)
		intervals = append(intervals, interval)
		date = interval.LowerEndpoint().AddDate(0, 0, -1)
	}
	return intervals, nil
}

func (g *GoogleAds) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	gaql := "SELECT " + strings.Join(g.fields, ",") + " FROM " + g.collection.Type
	if !interval.IsAll() {
		gaql += fmt.Sprintf(" WHERE segments.date BETWEEN '%s' AND '%s'", interval.LowerEndpoint().Format(dayLayout), interval.UpperEndpoint().Format(dayLayout))
	}
	array, err := query(g.config, g.httpClient, gaql)
	if err != nil {
		return err
	}
	return objectsLoader(array, 0, len(array), 0)
}

//TestGoogleAds tests connection to Google Ads without creating Driver instance
func TestGoogleAds(sourceConfig *base.SourceConfig) error {
	config := &GoogleAdsConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}
	config.FillPreconfiguredOauth(base.GoogleAdsType)
	if err := config.Validate(); err != nil {
		return err
	}
	gaql := "SELECT customer.id, customer.descriptive_name FROM customer WHERE customer.id = " + config.CustomerId
	obj, err := query(config, &http.Client{}, gaql)
	if err != nil {
		return fmt.Errorf("failed to get customer report: %v", err)
	}
	if len(obj) == 0 {
		return fmt.Errorf("no customer report data for customer_id: %s", config.CustomerId)
	}
	row := obj[0]
	customerId, ok := row["customer.id"]
	if !ok {
		return fmt.Errorf("unexpected customer report data: %v", row)
	}
	if fmt.Sprintf("%v", customerId) != config.CustomerId {
		return fmt.Errorf("customer_id in report data doesn't match: %v", row)
	}
	return nil
}

func (g *GoogleAds) Close() error {
	g.httpClient.CloseIdleConnections()
	return nil
}

func (g *GoogleAds) Type() string {
	return base.GoogleAdsType
}

func (g *GoogleAds) GetCollectionTable() string {
	if g.granularity == base.ALL {
		return g.collection.GetTableName() + "_all"
	} else {
		return g.collection.GetTableName() + "_by_" + strings.ToLower(g.granularity.String())
	}
}

func (g *GoogleAds) GetCollectionMetaKey() string {
	return g.collection.Name + "_" + g.GetCollectionTable()
}

func query(config *GoogleAdsConfig, httpClient *http.Client, query string) ([]map[string]interface{}, error) {
	developerToken := config.DeveloperToken
	if developerToken == "" {
		return nil, fmt.Errorf("Google Ads developer token was not provided")
	}

	accessToken, err := acquireAccessToken(config, httpClient)
	if err != nil {
		return nil, err
	}

	reqBody, err := json.Marshal(map[string]string{"query": query})
	if err != nil {
		return nil, fmt.Errorf("failed to marshal query request body: %s", err)
	}

	urlStr := serviceEndpoint + "/v8/customers/" + config.CustomerId + "/googleAds:searchStream"
	headers := map[string]string{
		"Content-Type":    "application/json",
		"Authorization":   "Bearer " + accessToken,
		"developer-token": developerToken}
	if config.ManagerCustomerId != "" {
		headers["login-customer-id"] = config.ManagerCustomerId
	}

	parseResponse := func(status int, body io.Reader, header http.Header) (interface{}, error) {
		jsonDecoder := json.NewDecoder(body)
		var bodyObject = make([]map[string]interface{}, 0, 1)
		if err := jsonDecoder.Decode(&bodyObject); err != nil {
			return nil, fmt.Errorf("failed to unmarshal response: %s", err)
		}
		if len(bodyObject) == 0 {
			//no data
			return []map[string]interface{}{}, nil
		}
		results, ok := bodyObject[0]["results"]
		if !ok {
			return nil, fmt.Errorf("no valid results found")
		}
		resultArray, ok := results.([]interface{})
		if !ok {
			return nil, fmt.Errorf("no valid results found. results type is: %T expected []interface{}", results)
		}
		transformedArray := make([]map[string]interface{}, len(resultArray))
		for i := 0; i < len(resultArray); i++ {
			castedRow, ok := resultArray[i].(map[string]interface{})
			if !ok {
				return nil, fmt.Errorf("invalid row: %v", resultArray[i])
			}
			transformed := make(map[string]interface{})
			if err := transformResult(castedRow, "", transformed); err != nil {
				return nil, fmt.Errorf("failed to transform row: %v", castedRow)
			}
			transformedArray[i] = transformed
		}
		return transformedArray, nil
	}

	req := httputils.Request{URL: urlStr, Method: http.MethodPost,
		Body: reqBody, Headers: headers,
		ParseReader: parseResponse}

	obj, err := req.Do(httpClient)
	if err != nil {
		return nil, err
	}
	return obj.([]map[string]interface{}), nil
}

func acquireAccessToken(config *GoogleAdsConfig, httpClient *http.Client) (string, error) {
	if config.AuthConfig.Type != base.GoogleOAuthAuthorizationType && config.AuthConfig.Subject == "" {
		return "", fmt.Errorf("'subject' is required. Subject – a Google Ads user with permissions on the Google Ads account you want to access. Google Ads does not support using service accounts without impersonation.")
	}
	jsonBytes, err := config.AuthConfig.Marshal()
	if err != nil {
		return "", err
	}
	cred, err := google.CredentialsFromJSONWithParams(context.Background(), jsonBytes, google.CredentialsParams{Scopes: []string{"https://www.googleapis.com/auth/adwords"}, Subject: config.AuthConfig.Subject})
	if err != nil {
		return "", err
	}
	token, err := cred.TokenSource.Token()
	if err != nil {
		return "", err
	}
	return token.AccessToken, nil
}

//transformResult fills a flat map with field names converted from camelCase to snake_case and integer and date
//fields that Google Ads API returns as strings converted to appropriate types.
func transformResult(input map[string]interface{}, prefix string, res map[string]interface{}) error {
	for name, field := range input {
		fullSnakeName := strcase.ToSnakeWithIgnore(strings.TrimLeft(prefix+"."+name, "."), ".")
		var err error
		switch f := field.(type) {
		case map[string]interface{}:
			field = nil //remove embed objects. Write its fields to a flat map `res`:
			err = transformResult(f, fullSnakeName, res)
		case string:
			switch fieldTypes[fullSnakeName] {
			case "INT64", "INT32":
				field, err = strconv.Atoi(f)
			case "DATE":
				field, err = parseDate(f)
			}
		}
		if err != nil {
			return err
		}
		if field != nil {
			res[fullSnakeName] = field
		}
	}
	return nil
}

func parseDate(input string) (time.Time, error) {
	date, err := time.Parse(dayLayout, input)
	if err != nil {
		dateTime, err := time.Parse(dateLayoutFull, input)
		if err != nil {
			return time.Time{}, err
		}
		return dateTime, nil
	}
	return date, nil
}
