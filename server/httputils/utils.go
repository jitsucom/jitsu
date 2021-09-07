package httputils

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
)

type Error struct {
	httpStatus int
	error      error
}

func (e *Error) Error() string {
	return fmt.Sprintf("http error. status: %d message: %s", e.httpStatus, e.error)
}

type Request struct {
	URL    string
	Method string
	Headers         map[string]string
	Body            []byte
	ExpectedStatues []int
	ParseReader func(status int, body io.Reader, header http.Header) (interface{}, error)
	ParseBytes  func(status int, body []byte, header http.Header) (interface{}, error)
}

func (r *Request) Do(client *http.Client) (interface{}, error) {
	switch r.Method {
	case http.MethodGet, http.MethodDelete, http.MethodTrace, http.MethodOptions, http.MethodHead:
		if r.Body != nil {
			return nil, fmt.Errorf("Body is not allowed for http Method %s", r.Method)
		}
	}
	if r.ExpectedStatues == nil {
		r.ExpectedStatues = []int{http.StatusOK}
	}
	var rqBodyReader io.Reader
	if r.Body != nil {
		rqBodyReader = bytes.NewReader(r.Body)
	}
	req, err := http.NewRequest(r.Method, r.URL, rqBodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to make request: %s", err)
	}
	for header, value := range r.Headers {
		req.Header.Add(header, value)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if !contains(r.ExpectedStatues, resp.StatusCode) {
		return nil, fmt.Errorf("http status: %d body: %s", resp.StatusCode, string(tryReadBody(resp.Body)))
	}
	if r.ParseReader != nil {
		return r.ParseReader(resp.StatusCode, resp.Body, resp.Header)
	} else if r.ParseBytes != nil {
		responseBody, err := io.ReadAll(resp.Body)
		if err != nil {
			return nil, err
		}
		return r.ParseBytes(resp.StatusCode, responseBody, resp.Header)
	} else {
		return resp.StatusCode, nil
	}
}

func tryReadBody(reader io.ReadCloser) []byte {
	body, _ := io.ReadAll(reader)
	return body
}

func contains(s []int, e int) bool {
	for _, a := range s {
		if a == e {
			return true
		}
	}
	return false
}
