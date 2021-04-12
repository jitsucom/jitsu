package jitsu

import (
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
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
}

//NewService returns Service and runs goroutine for cluster monitoring
func NewService(balancerAPIURL, adminToken string) *Service {
	return &Service{
		balancerAPIURL: strings.TrimSuffix(balancerAPIURL, "/"),
		adminToken:     adminToken,
		client:         &http.Client{Timeout: 1 * time.Minute},
	}
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
