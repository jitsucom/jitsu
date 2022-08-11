package amplitude

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/utils"
	"io/ioutil"
	"net/http"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/parsers"
)

const (
	defaultAmplitudeHost = "https://amplitude.com"
	amplitudeLayout      = "20060102T15"
	authorizationHeader  = "Authorization"

	AmplitudeActiveUsers     = "active_users"
	AmplitudeAnnotations     = "annotations"
	AmplitudeAverageSessions = "average_sessions"
	AmplitudeCohorts         = "cohorts"
	AmplitudeEvents          = "events"
	AmplitudeNewUsers        = "new_users"

	typeActiveUsers = "active"
	typeNewUsers    = "new"
)

type AmplitudeAdapter struct {
	httpClient *http.Client
	server     string
	authToken  string
}

func NewAmplitudeAdapter(apiKey, secretKey, server string, config *adapters.HTTPConfiguration) (*AmplitudeAdapter, error) {
	httpClient := &http.Client{
		Timeout: config.GlobalClientTimeout,
		Transport: &http.Transport{
			MaxIdleConns:        config.ClientMaxIdleConns,
			MaxIdleConnsPerHost: config.ClientMaxIdleConnsPerHost,
		},
	}

	token := fmt.Sprintf("%s:%s", apiKey, secretKey)
	encodedToken := base64.StdEncoding.EncodeToString([]byte(token))
	secretToken := fmt.Sprintf("Basic %s", encodedToken)

	return &AmplitudeAdapter{
		httpClient: httpClient,
		server:     utils.NvlString(server, defaultAmplitudeHost),
		authToken:  secretToken,
	}, nil
}

func (a *AmplitudeAdapter) Close() error {
	a.httpClient.CloseIdleConnections()
	return nil
}

func (a *AmplitudeAdapter) GetStatus() error {
	request := &adapters.Request{
		URL:    a.server + "/status",
		Method: "GET",
	}

	status, _, err := a.doRequest(request)
	if err != nil {
		return err
	}

	if status != http.StatusOK {
		return fmt.Errorf("Status returns not OK")
	}

	return nil
}

func (a *AmplitudeAdapter) GetEvents(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	start := interval.LowerEndpoint().Format(amplitudeLayout)
	end := interval.UpperEndpoint().Format(amplitudeLayout)

	url := fmt.Sprintf("%v/api/2/export?start=%s&end=%s", a.server, start, end)

	request := &adapters.Request{
		URL:    url,
		Method: "GET",
		Headers: map[string]string{
			authorizationHeader: a.authToken,
		},
	}

	status, response, err := a.doRequest(request)
	if err != nil {
		return nil, err
	}

	if status == http.StatusNotFound {
		// According to documentation, Amplitude returns 404 if there are no events at the requested time
		return nil, nil
	}

	if status != http.StatusOK {
		return nil, fmt.Errorf("Request does not return OK status [%v]: %v", status, string(response))
	}

	eventsArray, err := parseEvents(response)
	if err != nil {
		return nil, err
	}

	return eventsArray, nil
}

func (a *AmplitudeAdapter) GetUsers(interval *base.TimeInterval, collectionName string) ([]map[string]interface{}, error) {
	userType := ""
	switch collectionName {
	case AmplitudeActiveUsers:
		userType = typeActiveUsers
	case AmplitudeNewUsers:
		userType = typeNewUsers
	default:
		return nil, fmt.Errorf("Unexpected collection for amplitude users: %v", collectionName)
	}

	start := interval.LowerEndpoint().Format(amplitudeLayout)
	end := interval.UpperEndpoint().Format(amplitudeLayout)
	url := fmt.Sprintf("%v/api/2/users?start=%s&end=%s&m=%s", a.server, start, end, userType)

	request := &adapters.Request{
		URL:    url,
		Method: "GET",
		Headers: map[string]string{
			authorizationHeader: a.authToken,
		},
	}

	status, response, err := a.doRequest(request)
	if err != nil {
		return nil, err
	}

	if status != http.StatusOK {
		return nil, fmt.Errorf("Request does not return OK status [%v]: %v", status, string(response))
	}

	usersArray, err := parseDashboard(response, collectionName)
	if err != nil {
		return nil, err
	}

	return usersArray, nil
}

func (a *AmplitudeAdapter) GetSessions(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	start := interval.LowerEndpoint().Format(amplitudeLayout)
	end := interval.UpperEndpoint().Format(amplitudeLayout)
	url := fmt.Sprintf("%v/api/2/sessions/average?start=%s&end=%s", a.server, start, end)

	request := &adapters.Request{
		URL:    url,
		Method: "GET",
		Headers: map[string]string{
			authorizationHeader: a.authToken,
		},
	}

	status, response, err := a.doRequest(request)
	if err != nil {
		return nil, err
	}

	if status != http.StatusOK {
		return nil, fmt.Errorf("Request does not return OK status [%v]: %v", status, string(response))
	}

	sessionsArray, err := parseDashboard(response, AmplitudeAverageSessions)
	if err != nil {
		return nil, err
	}

	return sessionsArray, nil
}

func (a *AmplitudeAdapter) GetAnnotations() ([]map[string]interface{}, error) {
	url := fmt.Sprintf("%v/api/2/annotations", a.server)

	request := &adapters.Request{
		URL:    url,
		Method: "GET",
		Headers: map[string]string{
			authorizationHeader: a.authToken,
		},
	}

	status, response, err := a.doRequest(request)
	if err != nil {
		return nil, err
	}

	if status != http.StatusOK {
		return nil, fmt.Errorf("Request does not return OK status [%v]: %v", status, string(response))
	}

	annotationsArray, err := parseAnnotations(response)
	if err != nil {
		return nil, err
	}

	return annotationsArray, nil
}

func (a *AmplitudeAdapter) GetCohorts() ([]map[string]interface{}, error) {
	url := fmt.Sprintf("%v/api/3/cohorts", a.server)

	request := &adapters.Request{
		URL:    url,
		Method: "GET",
		Headers: map[string]string{
			authorizationHeader: a.authToken,
		},
	}

	status, response, err := a.doRequest(request)
	if err != nil {
		return nil, err
	}

	if status != http.StatusOK {
		return nil, fmt.Errorf("Request does not return OK status [%v]: %v", status, string(response))
	}

	cohortsArray, err := parseCohorts(response)
	if err != nil {
		return nil, err
	}

	return cohortsArray, nil
}

func (a *AmplitudeAdapter) doRequest(request *adapters.Request) (int, []byte, error) {
	var httpRequest *http.Request
	var err error
	if request.Body != nil && len(request.Body) > 0 {
		httpRequest, err = http.NewRequest(request.Method, request.URL, bytes.NewReader(request.Body))
	} else {
		httpRequest, err = http.NewRequest(request.Method, request.URL, nil)
	}

	if err != nil {
		return 0, nil, err
	}

	for header, value := range request.Headers {
		httpRequest.Header.Add(header, value)
	}

	response, err := a.httpClient.Do(httpRequest)
	if err != nil {
		return 0, nil, err
	}

	if response != nil && response.Body != nil {
		defer response.Body.Close()

		responseBody, err := ioutil.ReadAll(response.Body)
		if err != nil {
			return 0, nil, err
		}

		return response.StatusCode, responseBody, nil
	}

	return 0, nil, nil
}

func parseEvents(income []byte) ([]map[string]interface{}, error) {
	zipReader, err := zip.NewReader(bytes.NewReader(income), int64(len(income)))
	if err != nil {
		return nil, err
	}

	eventsArray := make([]map[string]interface{}, 0)

	for _, file := range zipReader.File {
		array, err := parseFileWithEvents(file)
		if err != nil {
			return nil, err
		}
		eventsArray = append(eventsArray, array...)
	}

	return eventsArray, nil
}

func parseFileWithEvents(file *zip.File) ([]map[string]interface{}, error) {
	fileReader, err := file.Open()
	if err != nil {
		return nil, err
	}
	defer fileReader.Close()

	buffer, err := ioutil.ReadAll(fileReader)
	if err != nil {
		return nil, err
	}

	gzipReader, err := gzip.NewReader(bytes.NewReader(buffer))
	if err != nil {
		return nil, err
	}
	defer gzipReader.Close()

	content, err := ioutil.ReadAll(gzipReader)
	if err != nil {
		return nil, err
	}

	array, err := parsers.ParseJSONFile(content)
	if err != nil {
		return nil, err
	}

	return array, nil
}

type dashboardData struct {
	XValues []string    `mapstructure:"xValues" json:"xValues,omitempty" yaml:"xValues,omitempty"`
	Series  [][]float64 `mapstructure:"series" json:"series,omitempty" yaml:"series,omitempty"`
}

type dashboardResponse struct {
	Data dashboardData `mapstructure:"data" json:"data,omitempty" yaml:"data,omitempty"`
}

func parseDashboard(income []byte, fieldName string) ([]map[string]interface{}, error) {
	response := &dashboardResponse{}
	if err := json.Unmarshal(income, &response); err != nil {
		return nil, err
	}

	array := make([]map[string]interface{}, 0)
	for i := 0; i < len(response.Data.Series) && i < len(response.Data.XValues); i++ {
		item := map[string]interface{}{
			fieldName: simplifyArrayValue(response.Data.Series[i]),
		}
		array = append(array, item)
	}

	return array, nil
}

func simplifyArrayValue(array []float64) interface{} {
	if len(array) == 1 {
		return array[0]
	}
	return array
}

type annotationData struct {
	ID      int    `mapstructure:"id" json:"id,omitempty" yaml:"id,omitempty"`
	Date    string `mapstructure:"date" json:"date,omitempty" yaml:"date,omitempty"`
	Label   string `mapstructure:"label" json:"label,omitempty" yaml:"label,omitempty"`
	Details string `mapstructure:"details" json:"details,omitempty" yaml:"details,omitempty"`
}

func (a *annotationData) exportToMap() map[string]interface{} {
	result := map[string]interface{}{
		"id":      a.ID,
		"date":    a.Date,
		"label":   a.Label,
		"details": a.Details,
	}
	return result
}

type annotationsResponse struct {
	Data []annotationData `mapstructure:"data" json:"data,omitempty" yaml:"data,omitempty"`
}

func parseAnnotations(income []byte) ([]map[string]interface{}, error) {
	response := &annotationsResponse{}
	if err := json.Unmarshal(income, &response); err != nil {
		return nil, err
	}

	array := make([]map[string]interface{}, 0)
	for i := 0; i < len(response.Data); i++ {
		item := response.Data[i].exportToMap()
		array = append(array, item)
	}

	return array, nil
}

type cohortData struct {
	AppId        string   `mapstructure:"appId" json:"appId,omitempty" yaml:"appId,omitempty"`
	Archived     bool     `mapstructure:"archived" json:"archived,omitempty" yaml:"archived,omitempty"`
	Description  string   `mapstructure:"description" json:"description,omitempty" yaml:"description,omitempty"`
	ID           string   `mapstructure:"id" json:"id,omitempty" yaml:"id,omitempty"`
	LastComputed string   `mapstructure:"lastComputed" json:"lastComputed,omitempty" yaml:"lastComputed,omitempty"`
	LastMod      string   `mapstructure:"lastMod" json:"lastMod,omitempty" yaml:"lastMod,omitempty"`
	Name         string   `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Owners       []string `mapstructure:"owners" json:"owners,omitempty" yaml:"owners,omitempty"`
	Published    bool     `mapstructure:"published" json:"published,omitempty" yaml:"published,omitempty"`
	Size         int      `mapstructure:"size" json:"size,omitempty" yaml:"size,omitempty"`
	Type         string   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
}

func (c *cohortData) exportToMap() map[string]interface{} {
	result := map[string]interface{}{
		"appId":        c.AppId,
		"archived":     c.Archived,
		"description":  c.Description,
		"id":           c.ID,
		"lastComputed": c.LastComputed,
		"lastMod":      c.LastMod,
		"name":         c.Name,
		"owners":       c.Owners,
		"published":    c.Published,
		"size":         c.Size,
		"type":         c.Type,
	}
	return result
}

type cohortsResponse struct {
	Cohorts []cohortData `mapstructure:"cohorts" json:"cohorts,omitempty" yaml:"cohorts,omitempty"`
}

func parseCohorts(income []byte) ([]map[string]interface{}, error) {
	response := &cohortsResponse{}
	if err := json.Unmarshal(income, &response); err != nil {
		return nil, err
	}

	array := make([]map[string]interface{}, 0)
	for i := 0; i < len(response.Cohorts); i++ {
		item := response.Cohorts[i].exportToMap()
		array = append(array, item)
	}

	return array, nil
}
