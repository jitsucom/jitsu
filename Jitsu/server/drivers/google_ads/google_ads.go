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
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/utils"
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
	serviceEndpoint = "https://googleads.googleapis.com/v13"
)

//go:embed reports.csv
var availableReportsCsv string
var availableReports = make(map[string]bool)

var intervalFields = [...]GoogleAdsFieldGranularity{
	{"segments.hour", schema.DAY}, //intended
	{"segments.date", schema.DAY},
	{"segments.day_of_week", schema.DAY},
	{"segments.week", schema.WEEK},
	{"segments.month", schema.MONTH},
	{"segments.month_of_year", schema.MONTH},
	{"segments.quarter", schema.QUARTER},
	{"segments.year", schema.YEAR},
}

func init() {
	base.RegisterDriver(base.GoogleAdsType, NewGoogleAds)
	base.RegisterTestConnectionFunc(base.GoogleAdsType, TestGoogleAds)
	for _, str := range strings.Split(availableReportsCsv, "\n") {
		availableReports[str] = true
	}
}

type GoogleAdsFieldGranularity struct {
	name        string
	granularity schema.Granularity
}
type GoogleAds struct {
	base.IntervalDriver

	collection  *base.Collection
	config      *GoogleAdsConfig
	fields      []string
	httpClient  *http.Client
	granularity schema.Granularity
}

type PagedResponse struct {
	NextPageToken     string
	TotalResultsCount int
	Results           []map[string]interface{}
}

// NewGoogleAds returns configured Google Ads driver instance
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

	granularity := schema.ALL
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
	if g.granularity == schema.ALL {
		return time.Hour * 24, nil
	} else {
		return time.Hour * 24 * 31, nil
	}
}

func (g *GoogleAds) ReplaceTables() bool {
	return false
}

func (g *GoogleAds) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	if g.granularity == schema.ALL {
		return []*base.TimeInterval{base.NewTimeInterval(schema.ALL, time.Time{})}, nil
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
	loaded := 0
	pageToken := ""
	for {
		pagedResponse, err := query(g.config, g.httpClient, gaql, pageToken)
		if err != nil {
			return err
		}
		err = objectsLoader(pagedResponse.Results, loaded, pagedResponse.TotalResultsCount, -1)
		if err != nil {
			return err
		}
		loaded += len(pagedResponse.Results)
		if pagedResponse.NextPageToken == "" {
			return nil
		}
		pageToken = pagedResponse.NextPageToken
	}
}

// TestGoogleAds tests connection to Google Ads without creating Driver instance
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
	obj, err := query(config, &http.Client{}, gaql, "")
	if err != nil {
		return fmt.Errorf("failed to get customer report: %v", err)
	}
	if len(obj.Results) == 0 {
		return fmt.Errorf("no customer report data for customer_id: %s", config.CustomerId)
	}
	row := obj.Results[0]
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
	if g.granularity == schema.ALL {
		return g.collection.GetTableName() + "_all"
	} else {
		return g.collection.GetTableName() + "_by_" + strings.ToLower(g.granularity.String())
	}
}

func (g *GoogleAds) GetCollectionMetaKey() string {
	return g.collection.Name + "_" + g.GetCollectionTable()
}

func query(config *GoogleAdsConfig, httpClient *http.Client, query string, pageToken string) (*PagedResponse, error) {
	developerToken := config.DeveloperToken
	if developerToken == "" {
		return nil, fmt.Errorf("Google Ads developer token was not provided")
	}

	accessToken, err := acquireAccessToken(config, httpClient)
	if err != nil {
		return nil, err
	}
	bodyObj := map[string]interface{}{"query": query, "returnTotalResultsCount": true, "pageSize": 10000}
	if pageToken != "" {
		bodyObj["pageToken"] = pageToken
	}
	reqBody, err := json.Marshal(bodyObj)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal query request body: %s", err)
	}

	urlStr := serviceEndpoint + "/customers/" + config.CustomerId + "/googleAds:search"
	headers := map[string]string{
		"Content-Type":    "application/json",
		"Authorization":   "Bearer " + accessToken,
		"developer-token": developerToken}
	if config.ManagerCustomerId != "" {
		headers["login-customer-id"] = config.ManagerCustomerId
	}

	parseResponse := func(status int, body io.Reader, header http.Header) (interface{}, error) {
		jsonDecoder := json.NewDecoder(body)
		jsonDecoder.UseNumber()
		var bodyObject = make(map[string]interface{})
		if err := jsonDecoder.Decode(&bodyObject); err != nil {
			return nil, fmt.Errorf("failed to unmarshal response: %s", err)
		}
		totalResultsCount, _ := strconv.Atoi(utils.MapNVLKeys(bodyObject, "-1", "totalResultsCount").(string))
		nextPageToken := utils.MapNVLKeys(bodyObject, "", "nextPageToken").(string)

		if len(bodyObject) == 0 {
			//no data
			return &PagedResponse{nextPageToken, totalResultsCount, []map[string]interface{}{}}, nil
		}
		results, ok := bodyObject["results"]
		if !ok {
			//no data
			return &PagedResponse{nextPageToken, totalResultsCount, []map[string]interface{}{}}, nil
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
		return &PagedResponse{nextPageToken, totalResultsCount, transformedArray}, nil
	}

	req := httputils.Request{URL: urlStr, Method: http.MethodPost,
		Body: reqBody, Headers: headers,
		ParseReader: parseResponse}

	obj, err := req.Do(httpClient)
	if err != nil {
		return nil, err
	}
	return obj.(*PagedResponse), nil
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

// transformResult fills a flat map with field names converted from camelCase to snake_case and integer and date
// fields that Google Ads API returns as strings converted to appropriate types.
func transformResult(input map[string]interface{}, prefix string, res map[string]interface{}) error {
	for name, field := range input {
		fullSnakeName := strcase.ToSnakeWithIgnore(strings.TrimLeft(prefix+"."+name, "."), ".")
		var err error
		switch f := field.(type) {
		case map[string]interface{}:
			field = nil //remove embed objects. Write its fields to a flat map `res`:
			err = transformResult(f, fullSnakeName, res)
		case string:
			must := fieldTypes[fullSnakeName]
			switch must {
			case "INT64", "INT32":
				field, err = strconv.Atoi(f)
			case "FLOAT", "DOUBLE":
				field, err = strconv.ParseFloat(f, 64)
			case "DATE":
				field, err = parseDate(f)
			}
		case json.Number:
			must := fieldTypes[fullSnakeName]
			switch must {
			case "INT64", "INT32":
				field, err = f.Int64()
			case "FLOAT", "DOUBLE":
				field, err = f.Float64()
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
