package amplitude

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io/ioutil"
	"net/http"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/parsers"
)

const AmplitudeURL = "https://amplitude.com"
const AmplitudeLayout = "20060102T15"
const AmplitudeEvents = "events"

type AmplitudeAdapter struct {
	httpClient *http.Client
	authToken  string
}

func NewAmplitudeAdapter(apiKey, secretKey string, config *adapters.HTTPConfiguration) (*AmplitudeAdapter, error) {
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
		authToken:  secretToken,
	}, nil
}

func (a *AmplitudeAdapter) Close() error {
	a.httpClient.CloseIdleConnections()
	return nil
}

func (a *AmplitudeAdapter) GetStatus() error {
	request := &adapters.Request{
		URL:    AmplitudeURL + "/status",
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
	start := interval.LowerEndpoint().Format(AmplitudeLayout)
	end := interval.UpperEndpoint().Format(AmplitudeLayout)

	url := fmt.Sprintf("%v/api/2/export?start=%s&end=%s", AmplitudeURL, start, end)

	request := &adapters.Request{
		URL:     url,
		Method:  "GET",
		Headers: map[string]string{},
	}

	request.Headers["Authorization"] = a.authToken

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

		eventsArray = append(eventsArray, array...)
	}

	return eventsArray, nil
}
