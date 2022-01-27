package cmd

import (
	"bytes"
	"fmt"
	"io/ioutil"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"time"
)

//bulkClient is an HTTP client which send multiform data to bulk API
type bulkClient struct {
	httpClient *http.Client
	url        string
}

//newBulkClient returns configured bulkClient
func newBulkClient(host, apiKey string, fallbackFormat, skipMalformed bool) *bulkClient {
	url := strings.TrimRight(host, "/") + "/api/v1/events/bulk?token=" + apiKey
	if fallbackFormat {
		url += "&fallback=true"
	}
	if skipMalformed {
		url += "&skip_malformed=true"
	}
	return &bulkClient{
		httpClient: &http.Client{Timeout: 3 * time.Minute},
		url:        url,
	}
}

//sendGzippedMultiPart sends gzipped payload as multipart POST request
//updates progress bar
//returns error if occurred
func (bc *bulkClient) sendGzippedMultiPart(fileProgressBar ProgressBar, filePath string, payload []byte) error {
	body := new(bytes.Buffer)
	mpw := multipart.NewWriter(body)
	part, err := mpw.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return err
	}

	if _, err := part.Write(payload); err != nil {
		return err
	}
	mpw.Close()

	var req *http.Request
	if fileProgressBar != nil && fileProgressBar.Type() != dummyType {
		proxyReader := fileProgressBar.ProxyReader(body)
		defer proxyReader.Close()

		req, err = http.NewRequest(http.MethodPost, bc.url, proxyReader)
	} else {
		req, err = http.NewRequest(http.MethodPost, bc.url, bytes.NewReader(body.Bytes()))
	}

	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", mpw.FormDataContentType())
	req.Header.Set("Content-Encoding", "gzip")

	resp, err := bc.httpClient.Do(req)
	if err != nil {
		return err
	}

	var responseBody string

	if resp.Body != nil {
		defer resp.Body.Close()

		rb, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return err
		}

		responseBody = string(rb)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Jitsu HTTP code: %d response: %s", resp.StatusCode, responseBody)
	}

	return nil
}
