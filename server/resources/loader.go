package resources

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/utils"
	"io/ioutil"
	"net/http"
	"net/url"
	"strings"
)

type ContentType string

const (
	lastModifiedHeader    = "Last-Modified"
	ifModifiedSinceHeader = "If-Modified-Since"

	JSONContentType    ContentType = "json"
	YamlContentType    ContentType = "yaml"
	UnknownContentType ContentType = "unknown"
)

var ErrNoModified = errors.New("Resource wasn't modified")

type ResponsePayload struct {
	Content      []byte
	LastModified string

	ContentType *ContentType
}

//LoadFromFile returns loaded content, empty string (because there is no last-modified logic in files), error
func LoadFromFile(filePath, lastModified string) (*ResponsePayload, error) {
	filePath = strings.ReplaceAll(filePath, "file://", "")

	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("Error loading resource from file %s: %v", filePath, err)
	}

	var contentType ContentType
	if strings.HasSuffix(filePath, ".yaml") || strings.HasSuffix(filePath, ".yml") {
		contentType = YamlContentType
	} else if strings.HasSuffix(filePath, ".json") {
		contentType = JSONContentType
	} else {
		logging.Errorf("Unknown content type in config file: %s", filePath)
		contentType = UnknownContentType
	}

	return &ResponsePayload{Content: b, ContentType: &contentType}, nil
}

//LoadFromHTTP returns loaded content, Last-modified value from header, error
func LoadFromHTTP(fullURL, ifModifiedSinceValue string) (*ResponsePayload, error) {
	var username, password string
	if strings.Contains(fullURL, "@") {
		parsedURL, err := url.Parse(fullURL)
		if err != nil {
			return nil, err
		}

		if parsedURL.User != nil {
			username = parsedURL.User.Username()
			pass, ok := parsedURL.User.Password()
			if ok {
				password = pass
			}
		}

		urlParts := strings.Split(fullURL, "@")
		if strings.HasPrefix(fullURL, "https:") {
			fullURL = "https://" + urlParts[1]
		} else {
			fullURL = "http://" + urlParts[1]
		}
	}

	req, err := http.NewRequest(http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, err
	}

	if username != "" {
		req.SetBasicAuth(username, password)
	}

	req.Header.Add(ifModifiedSinceHeader, ifModifiedSinceValue)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("Error loading resource from url %s: %v", fullURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 304 {
		return nil, ErrNoModified
	}
	b, err := ioutil.ReadAll(resp.Body)

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("Error loading resource from url %s: http code: %d response: %s", fullURL, resp.StatusCode, utils.ShortenString(string(b), 256))
	}

	if err != nil {
		return nil, fmt.Errorf("Error reading resource from url %s: %v", fullURL, err)
	}

	httpContentType := resp.Header.Get("Content-Type")

	var contentType ContentType
	if strings.Contains(httpContentType, "yaml") {
		contentType = YamlContentType
	} else if strings.Contains(httpContentType, "json") {
		contentType = JSONContentType
	} else {
		logging.Errorf("Unknown content type [%s] in response from url: %s", httpContentType, fullURL)
		contentType = UnknownContentType
	}

	return &ResponsePayload{
		Content:      b,
		LastModified: resp.Header.Get(lastModifiedHeader),
		ContentType:  &contentType,
	}, nil
}
