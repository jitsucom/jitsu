package amplitude

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io/ioutil"

	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/parsers"
)

const AmplitudeURL = "https://amplitude.com"
const AmplitudeLayout = "20060102T15"

type AmplitudeAdapter struct {
	httpAdapter *HTTPAdapter
	authToken   string
}

func NewAmplitudeAdapter(ID, apiKey, secretKey string) (*AmplitudeAdapter, error) {
	config := &HTTPAdapterConfiguration{
		Dir: "test",
		HTTPConfig: &HTTPConfiguration{
			ClientMaxIdleConns:        100,
			ClientMaxIdleConnsPerHost: 10,
		},
		DestinationID: ID,
		PoolWorkers:   10,
	}

	httpAdapter, err := NewHTTPAdapter(config)
	if err != nil {
		return nil, err
	}

	token := fmt.Sprintf("%s:%s", apiKey, secretKey)
	encodedToken := base64.StdEncoding.EncodeToString([]byte(token))
	secretToken := fmt.Sprintf("Basic %s", encodedToken)

	return &AmplitudeAdapter{
		httpAdapter: httpAdapter,
		authToken:   secretToken,
	}, nil
}

func (a *AmplitudeAdapter) Close() error {
	return a.httpAdapter.Close()
}

func (a *AmplitudeAdapter) GetStatus() error {
	request := &Request{
		URL:    AmplitudeURL + "/status",
		Method: "GET",
	}

	if _, err := a.httpAdapter.doRequest(request); err != nil {
		return err
	}

	return nil
}

func (a *AmplitudeAdapter) GetEvents(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	start := interval.LowerEndpoint().Format(AmplitudeLayout)
	end := interval.UpperEndpoint().Format(AmplitudeLayout)

	url := fmt.Sprintf("%v/api/2/export?start=%s&end=%s", AmplitudeURL, start, end)

	request := &Request{
		URL:     url,
		Method:  "GET",
		Headers: map[string]string{},
	}

	request.Headers["Authorization"] = a.authToken

	response, err := a.httpAdapter.doRequest(request)
	if err != nil {
		return nil, err
	}

	eventsArray, err := parseEvents(response)
	if err != nil {
		return nil, err
	}

	return eventsArray, nil
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
