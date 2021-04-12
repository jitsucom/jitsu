package jitsu

import (
	"bytes"
	"encoding/json"
	"fmt"
	enevents "github.com/jitsucom/jitsu/server/events"
	enhandlers "github.com/jitsucom/jitsu/server/handlers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"io/ioutil"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const adminTokenName = "X-Admin-Token"

//Service is used for communicate with Jitsu Server
type Service struct {
	sync.RWMutex

	balancerAPIURL string
	adminToken     string

	client *http.Client

	instanceURLs []string

	closed bool
}

//NewService returns Service and runs goroutine for cluster monitoring
func NewService(balancerAPIURL, adminToken string) *Service {
	s := &Service{
		balancerAPIURL: strings.TrimSuffix(balancerAPIURL, "/"),
		adminToken:     adminToken,
		client:         &http.Client{Timeout: 1 * time.Minute},

		instanceURLs: []string{},
	}

	s.startClusterMonitor()

	return s
}

func (s *Service) GetOldEvents(apiKeys []string, limit int) ([]enevents.Event, error) {
	s.RLock()
	enInstances := s.instanceURLs
	s.RUnlock()

	response := []enevents.Event{}

	for _, enInstanceUri := range enInstances {
		code, body, err := s.sendReq(http.MethodGet, enInstanceUri+"/api/v1/cache/events?apikeys="+strings.Join(apiKeys, ",")+"&limit_per_apikey="+strconv.Itoa(limit), nil)
		if err != nil {
			return nil, err
		}

		if code != http.StatusOK {
			return nil, fmt.Errorf("Error getting response from EventNative: http code isn't 200: %d", code)
		}

		content := &enhandlers.OldCachedEventsResponse{}
		if err = json.Unmarshal(body, content); err != nil {
			return nil, fmt.Errorf("Error unmarshalling response from EventNative: %v", err)
		}

		if len(response) == 0 && len(content.Events) >= limit {
			return content.Events[:limit], nil
		}

		response = append(response, content.Events...)

		if len(response) >= limit {
			return response[:limit], nil
		}
	}

	return response, nil
}

func (s *Service) GetLastEvents(destinationIDs string, start, end string, limit int) (*enhandlers.CachedEventsResponse, error) {
	code, body, err := s.ProxySend(&Request{
		Method: http.MethodGet,
		URN:    "/api/v1/events/cache?destination_ids=" + destinationIDs + "&limit=" + strconv.Itoa(limit) + "&start=" + start + "&end=" + end,
		Body:   nil,
	})
	if err != nil {
		return nil, err
	}

	if code != http.StatusOK {
		return nil, fmt.Errorf("Error getting response from EventNative: http code isn't 200: %d", code)
	}

	content := &enhandlers.CachedEventsResponse{}
	if err = json.Unmarshal(body, content); err != nil {
		return nil, fmt.Errorf("Error unmarshalling response from EventNative: %v", err)
	}

	return content, nil
}

func (s *Service) TestDestination(reqB []byte) (int, []byte, error) {
	return s.ProxySend(&Request{
		Method: http.MethodPost,
		URN:    "/api/v1/destinations/test",
		Body:   bytes.NewBuffer(reqB),
	})
}

func (s *Service) TestSource(reqB []byte) (int, []byte, error) {
	return s.ProxySend(&Request{
		Method: http.MethodPost,
		URN:    "/api/v1/sources/test",
		Body:   bytes.NewBuffer(reqB),
	})
}

//starts goroutine for getting cluster information and saves it to instanceURLs
func (s *Service) startClusterMonitor() {
	safego.RunWithRestart(func() {
		for {
			if s.closed {
				break
			}

			instanceURLs, err := s.getClusterURLs()
			if err != nil {
				logging.Errorf("Error getting cluster info from Jitsu Server: %v", err)
				//delay after error
				time.Sleep(10 * time.Second)
				continue
			}

			s.Lock()
			s.instanceURLs = instanceURLs
			s.Unlock()

			time.Sleep(time.Minute)
		}
	})
}

//getClusterURLs returns array of Jitsu Server cluster URLs
func (s *Service) getClusterURLs() ([]string, error) {
	code, body, err := s.ProxySend(&Request{
		Method: http.MethodGet,
		URN:    "/api/v1/cluster",
		Body:   nil,
	})
	if err != nil {
		return nil, err
	}

	if code != http.StatusOK {
		return nil, fmt.Errorf("http code isn't 200: %d", code)
	}

	content := &enhandlers.ClusterInfo{}
	if err = json.Unmarshal(body, content); err != nil {
		return nil, fmt.Errorf("Error unmarshalling response from Jitsu Server: %v", err)
	}

	instanceURLs := []string{}
	for _, instance := range content.Instances {
		if !strings.HasPrefix(instance.Name, "http") {
			instance.Name = "https://" + instance.Name
		}
		instanceURLs = append(instanceURLs, instance.Name)
	}

	return instanceURLs, nil
}

//ProxySend sends HTTP request to balancerAPIURL with input parameters
func (s *Service) ProxySend(req *Request) (int, []byte, error) {
	return s.sendReq(req.Method, s.balancerAPIURL+"/"+strings.TrimPrefix(req.URN, "/"), req.Body)
}

//sendReq sends HTTP request
func (s *Service) sendReq(method, url string, body io.Reader) (int, []byte, error) {
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		return 0, nil, fmt.Errorf("Error creating request: %v", err)
	}

	req.Header.Add(adminTokenName, s.adminToken)
	resp, err := s.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("Error getting response from EventNative: %v", err)
	}
	defer func() {
		if resp.Body != nil {
			resp.Body.Close()
		}
	}()

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("Error reading response from EventNative: %v", err)
	}

	return resp.StatusCode, respBody, nil
}

//Close stops cluster monitoring goroutine
func (s *Service) Close() error {
	s.closed = true
	return nil
}
