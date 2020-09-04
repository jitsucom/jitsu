package resources

import (
	"fmt"
	"io/ioutil"
	"net/http"
)

func LoadFromFile(filePath string) ([]byte, error) {
	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("Error loading resource from file %s: %v", filePath, err)
	}
	return b, nil
}

func LoadFromHttp(url string) ([]byte, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("Error loading resource from url %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Error loading resource from url %s: http code isn't 200 [%d]", url, resp.StatusCode)
	}

	b, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("Error reading resource from url %s: %v", url, err)
	}

	return b, nil
}
