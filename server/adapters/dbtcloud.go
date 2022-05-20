package adapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"

	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/templates"
)

const (
	method        = "POST"
	urlFormat     = "https://cloud.getdbt.com/api/v2/accounts/%d/jobs/%d/run/"
	testUrlFormat = "https://cloud.getdbt.com/api/v2/accounts/%d/jobs/%d/"
	bodyFormat    = `{"cause": "%s"}`
)

//DbtCloudConfig is a dto for parsing DbtCloud configuration
type DbtCloudConfig struct {
	AccountId int    `mapstructure:"account_id,omitempty" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	JobId     int    `mapstructure:"job_id,omitempty" json:"job_id,omitempty" yaml:"job_id,omitempty"`
	Cause     string `mapstructure:"cause,omitempty" json:"cause,omitempty" yaml:"cause,omitempty"`
	Token     string `mapstructure:"token,omitempty" json:"token,omitempty" yaml:"token,omitempty"`
	Enabled   bool   `mapstructure:"enabled,omitempty" json:"enabled,omitempty" yaml:"enabled,omitempty"`
}

//Validate returns err if invalid
func (dcc *DbtCloudConfig) Validate() error {
	if dcc == nil {
		return errors.New("DbtCloud config is required")
	}
	switch {
	case dcc.AccountId == 0:
		return errors.New("'account_id' is required parameter")
	case dcc.JobId == 0:
		return errors.New("'job_id' is required parameter")
	case dcc.Cause == "":
		return errors.New("'cause' is required parameter")
	case dcc.Token == "":
		return errors.New("'token' is required parameter")
	}
	return nil
}

//DbtCloud is an adapter for sending HTTP requests with predefined headers and templates for URL, body
type DbtCloud struct {
	AbstractHTTP
	config *DbtCloudConfig
}

//NewDbtCloud returns configured DbtCloud adapter instance
func NewDbtCloud(config *DbtCloudConfig, httpAdapterConfiguration *HTTPAdapterConfiguration) (*DbtCloud, error) {
	var err error = nil
	httpAdapterConfiguration.HTTPReqFactory, err = newDbtCloudRequestFactory(config)
	if err != nil {
		return nil, err
	}
	httpAdapter, err := NewHTTPAdapter(httpAdapterConfiguration)
	if err != nil {
		return nil, err
	}

	dbt := &DbtCloud{config: config}
	dbt.httpAdapter = httpAdapter

	return dbt, nil
}

//NewTestDbtCloud returns configured DbtCloud adapter instance for testing connection
func NewTestDbtCloud(config *DbtCloudConfig) *DbtCloud {
	return &DbtCloud{config: config}
}

//TestAccess sends Get Job object request to dbt cloud and checks job state
func (dbt *DbtCloud) TestAccess() error {
	url := fmt.Sprintf(testUrlFormat, dbt.config.AccountId, dbt.config.JobId)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return fmt.Errorf("Error creating test request: %s : %v", url, err)
	}
	req.Header.Add("Authorization", "Token "+dbt.config.Token)
	//send empty request and expect error
	r, err := http.DefaultClient.Do(req)
	if r != nil && r.Body != nil {
		defer r.Body.Close()
		responseBody, err := ioutil.ReadAll(r.Body)
		if err != nil {
			return fmt.Errorf("Error reading dbtcloud API response body: %v", err)
		}
		if r.StatusCode != 200 {
			return fmt.Errorf("Error dbtcloud API response with status: %d body: %v", r.StatusCode, string(responseBody))
		}
		var body = make(map[string]interface{})
		if err := json.Unmarshal(responseBody, &body); err != nil {
			return fmt.Errorf("Failed to parse dbtcloud API response body: %s : %v", string(responseBody), err)
		}
		data, ok := body["data"].(map[string]interface{})
		if !ok {
			return fmt.Errorf("Failed to parse dbtcloud API response: %v", string(responseBody))
		}
		if fmt.Sprintf("%v", data["state"]) != "1" {
			return fmt.Errorf("Job state is not active: %v", data["state"])
		}
		return nil
	}

	if err != nil {
		return err
	}

	return errors.New("Empty dbt Cloud  response body")
}

//Type returns adapter type
func (dbt *DbtCloud) Type() string {
	return "DbtCloud"
}

type DbtCloudRequestFactory struct {
	config        *DbtCloudConfig
	causeTemplate templates.TemplateExecutor
}

//newDbtCloudRequestFactory returns configured HTTPRequestFactory instance for dbtcloud requests
func newDbtCloudRequestFactory(config *DbtCloudConfig) (HTTPRequestFactory, error) {
	causeTmpl, err := templates.SmartParse("cause", config.Cause, templates.JSONSerializeFuncs)
	if err != nil {
		return nil, fmt.Errorf("Error parsing Cause template [%s]: %v", config.Cause, err)
	}

	return &DbtCloudRequestFactory{
		config:        config,
		causeTemplate: causeTmpl,
	}, nil
}

//Create implements HTTPRequestFactory interface
func (dcc *DbtCloudRequestFactory) Create(object map[string]interface{}) (req *Request, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			req = nil
			err = fmt.Errorf("Error constructing dbtcloud request: %v", r)
		}
	}()

	cause, err := dcc.causeTemplate.ProcessEvent(object, nil)
	if err != nil {
		return nil, fmt.Errorf("Error executing Cause template: %v", err)
	}

	url := fmt.Sprintf(urlFormat, dcc.config.AccountId, dcc.config.JobId)
	body := fmt.Sprintf(bodyFormat, jsonutils.JsonEscape(templates.ToString(cause, false, false, false)))
	headers := map[string]string{
		"Authorization": "Token " + dcc.config.Token,
		"Content-Type":  "application/json",
	}
	return &Request{
		URL:     url,
		Method:  method,
		Body:    []byte(body),
		Headers: headers,
	}, nil
}

func (dcc *DbtCloudRequestFactory) Close() {
	dcc.causeTemplate.Close()
}
