package resources

import (
	"errors"
	"fmt"
	"io/ioutil"
	"net/http"
)

const (
	lastModifiedHeader    = "Last-Modified"
	ifModifiedSinceHeader = "If-Modified-Since"
)

var ErrNoModified = errors.New("Resource wasn't modified")

//return loaded content, empty string (because there is no last-modified logic in files), error
func LoadFromFile(filePath, lastModified string) ([]byte, string, error) {
	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, "", fmt.Errorf("Error loading resource from file %s: %v", filePath, err)
	}
	return b, "", nil
}

//return loaded content, Last-modified value from header, error
func LoadFromHttp(url, ifModifiedSinceValue string) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}

	req.Header.Add(ifModifiedSinceHeader, ifModifiedSinceValue)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("Error loading resource from url %s: %v", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 304 {
		return nil, "", ErrNoModified
	}

	if resp.StatusCode != 200 {
		return nil, "", fmt.Errorf("Error loading resource from url %s: http code isn't 200 [%d]", url, resp.StatusCode)
	}

	b, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("Error reading resource from url %s: %v", url, err)
	}

	return b, resp.Header.Get(lastModifiedHeader), nil
}
