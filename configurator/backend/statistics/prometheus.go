package statistics

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/prometheus/common/model"
	"io/ioutil"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

type PrometheusConfig struct {
	Host     string `mapstructure:"host"`
	Username string `mapstructure:"username"`
	Password string `mapstructure:"password"`
}

func (pc *PrometheusConfig) Validate() error {
	if pc == nil {
		return errors.New("Prometheus config is required")
	}
	if pc.Host == "" {
		return errors.New("Prometheus host is required parameter")
	}
	if pc.Username == "" {
		return errors.New("Prometheus username is required parameter")
	}
	if pc.Password == "" {
		return errors.New("Prometheus password is required parameter")
	}
	return nil
}

type QueryRangeResponse struct {
	Status string         `json:"status"`
	Data   QueryRangeData `json:"data"`
}

type QueryRangeData struct {
	ResultType string       `json:"resultType"`
	Result     model.Matrix `json:"result"`
}

type Prometheus struct {
	config     *PrometheusConfig
	httpClient *http.Client
}

func NewPrometheus(config *PrometheusConfig) (Storage, error) {
	return &Prometheus{
		config:     config,
		httpClient: &http.Client{Timeout: 1 * time.Minute},
	}, nil
}

func (p *Prometheus) GetEvents(projectID string, start, end time.Time, granularity string) ([]EventsPerTime, error) {
	var sumWithTime, step string
	switch granularity {
	case DayGranularity:
		sumWithTime = "24h"
		step = "86400"
	case HourGranularity:
		sumWithTime = "1h"
		step = "3600"
	default:
		return nil, fmt.Errorf("Unknown granularity: %s", granularity)
	}

	urlPath, err := url.Parse(p.config.Host + "/api/v1/query_range")
	if err != nil {
		return nil, fmt.Errorf("Error parsing Prometheus url: %v", err)
	}

	q := urlPath.Query()
	q.Set("query", fmt.Sprintf(`round(sum(increase(eventnative_destinations_events{project_id="%s"}[%s])))`, projectID, sumWithTime))
	q.Set("start", formatTime(start))
	q.Set("end", formatTime(end))
	q.Set("step", step)

	urlPath.RawQuery = q.Encode()
	req, err := http.NewRequest(http.MethodGet, urlPath.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("Error creating Prometheus http request: %v", err)
	}

	req.SetBasicAuth(p.config.Username, p.config.Password)
	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Error sending Prometheus http request: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Error Prometheus http response code: %d", resp.StatusCode)
	}

	body, err := ioutil.ReadAll(resp.Body)
	qrr := &QueryRangeResponse{}
	if err := json.Unmarshal(body, qrr); err != nil {
		return nil, fmt.Errorf("Error parsing Prometheus response: %v", err)
	}

	if qrr.Data.ResultType != model.ValMatrix.String() {
		return nil, fmt.Errorf("Unknown Prometheus response type: %s. Expected - %s", qrr.Data.ResultType, model.ValMatrix.String())
	}

	if len(qrr.Data.Result) == 0 {
		return []EventsPerTime{}, nil
	}

	unit := qrr.Data.Result[0]
	if unit == nil {
		return nil, errors.New("Malformed Prometheus response: nil element")
	}

	eventsPerTime := []EventsPerTime{}
	for _, v := range unit.Values {
		eventsPerTime = append(eventsPerTime, EventsPerTime{Key: v.Timestamp.Time().Format(responseTimestampLayout), Events: int(v.Value)})
	}

	return eventsPerTime, nil
}

func (p *Prometheus) Close() error {
	return nil
}

func formatTime(t time.Time) string {
	return strconv.FormatFloat(float64(t.Unix())+float64(t.Nanosecond())/1e9, 'f', -1, 64)
}
