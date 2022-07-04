package jitsu

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	smdlwr "github.com/jitsucom/jitsu/server/middleware"
	"io"
	"io/ioutil"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

var ErrServerTimeout = errors.New("The server did not respond within 10 minutes. Please try again. If you think this is a system error, write to us support@jitsu.com")

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
		client:         &http.Client{Timeout: 10 * time.Minute},
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

func (s *Service) EvaluateExpression(reqB []byte) (int, []byte, error) {
	return s.ProxySend(&Request{
		Method: http.MethodPost,
		URN:    "/api/v1/templates/evaluate",
		Body:   bytes.NewBuffer(reqB),
	})
}

//ProxySend sends HTTP request to balancerAPIURL with input parameters
func (s *Service) ProxySend(req *Request) (int, []byte, error) {
	return s.sendReq(req.Method, s.balancerAPIURL+"/"+strings.TrimPrefix(req.URN, "/"), req.Body)
}

//sendReq sends HTTP request
func (s *Service) sendReq(method, requestURL string, body io.Reader) (int, []byte, error) {
	req, err := http.NewRequest(method, requestURL, body)
	if err != nil {
		return 0, nil, fmt.Errorf("Error creating request: %v", err)
	}

	req.Header.Add(smdlwr.AdminTokenKey, s.adminToken)
	resp, err := s.client.Do(req)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			return 0, nil, ErrServerTimeout
		}
		urlErr, ok := err.(*url.Error)
		if ok && urlErr.Timeout() {
			return 0, nil, ErrServerTimeout
		}

		return 0, nil, fmt.Errorf("Error getting response: %v", err)
	}
	defer func() {
		if resp.Body != nil {
			resp.Body.Close()
		}
	}()

	respBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("Error reading response: %v", err)
	}

	return resp.StatusCode, respBody, nil
}
