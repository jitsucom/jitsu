package templates

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"net/http/httptest"
	"rogchap.com/v8go"
	"strings"
)

//go:embed js/fetch.js
var bundle string

// InjectFetch inserts the fetch polyfill into ctx.  The server parameter may be non-
// nil to support relative URLs that have no host (e.g. /foo/bar instead of
// https://host.com/foo/bar).  If server is nil, then such relative URLs will
// always fail.  The fetch polyfill only supports http and https schemes.
func InjectFetch(ctx *v8go.Context, server http.Handler) error {
	const get_fetch = `;fetch.goFetchSync=globalThis.goFetchSync;`
	_, err := ctx.RunScript(bundle+get_fetch, "fetch-bundle.js")
	if err != nil {
		return fmt.Errorf("v8fetch injection failed: %v", err)
	}
	return nil
}

type syncFetcher struct {
	local http.Handler
}

func FetchSync(in *v8go.FunctionCallbackInfo) *v8go.Value {
	if len(in.Args()) != 2 {
		return errorToV8Value(in.Context(), fmt.Sprintf("Expected 2 args (url, options), got %d.", len(in.Args())))
	}
	url := in.Args()[0].String()

	opts := options{
		Method:  "GET",
		Headers: http.Header{},
	}
	if err := json.Unmarshal([]byte(in.Args()[1].String()), &opts); err != nil {
		return errorToV8Value(in.Context(), fmt.Sprintf("Cannot decode JSON options: %v", err))
	}

	opts.Method = strings.ToUpper(opts.Method)
	// Make sure the header keys are capitalized correctly.  The node lib we
	// use lower-cases everything.
	for k, v := range opts.Headers {
		adj := http.CanonicalHeaderKey(k)
		delete(opts.Headers, k)
		opts.Headers[adj] = v
	}

	var resp response
	if strings.HasPrefix(url, "http") || strings.HasPrefix(url, "//") {
		resp = fetchHttp(url, opts)
	} else {
		return errorToV8Value(in.Context(), fmt.Sprintf(
			"v8fetch only supports http(s) or local (relative) URIs: %s", url))
	}
	return responseToV8Value(in.Context(), resp)
}

func responseToV8Value(v8ctx *v8go.Context, resp response) *v8go.Value {
	ret, err := json.Marshal(resp)
	if err != nil {
		return errorToV8Value(v8ctx, err.Error())
	}
	retV, err := v8go.JSONParse(v8ctx, string(ret))
	if err != nil {
		return errorToV8Value(v8ctx, err.Error())
	}
	return retV
}

func errorToV8Value(v8ctx *v8go.Context, error string) *v8go.Value {
	template := v8go.NewObjectTemplate(v8ctx.Isolate())
	template.Set("status", -1)
	template.Set("body", error)
	r, err := template.NewInstance(v8ctx)
	if err != nil {
		e, _ := v8go.NewValue(v8ctx.Isolate(), error)
		return e
	}
	return r.Value
}

type options struct {
	Url     string      `json:"url"`
	Method  string      `json:"method"`
	Headers http.Header `json:"headers"`
	Body    string      `json:"body"`
}

type response struct {
	options
	Status     int     `json:"status"`
	StatusText string  `json:"statusText,omitempty"`
	Errors     []error `json:"errors"`
}

func fetchHttp(url string, opts options) response {
	result := response{Status: 0}
	result.Url = opts.Url

	var body io.Reader
	if opts.Method == "POST" || opts.Method == "PUT" || opts.Method == "PATCH" {
		body = strings.NewReader(opts.Body)
	}
	req, err := http.NewRequest(opts.Method, url, body)
	if err != nil {
		result.Errors = append(result.Errors, err)
		result.Body = err.Error()
		return result
	}
	for k, v := range opts.Headers {
		for _, v := range v {
			req.Header.Add(k, v)
		}
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		result.Errors = append(result.Errors, err)
	}
	if resp != nil {
		defer resp.Body.Close()
		result.Status = resp.StatusCode
		result.StatusText = resp.Status
		result.Headers = resp.Header
		body, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			result.Errors = append(result.Errors, err)
		}
		result.Body = string(body)
	}
	if result.Body == "" && len(result.Errors) > 0 {
		errorText := result.Errors[0].Error()
		for i := 1; i < len(result.Errors); i++ {
			errorText = errorText + ": " + result.Errors[i].Error()
		}
		result.Body = errorText
	}
	return result
}

func fetchHandlerFunc(server http.Handler, url string, opts options) response {
	result := response{
		options: opts,
		Status:  http.StatusInternalServerError,
		Errors:  []error{},
	}

	if server == nil {
		result.Errors = append(result.Errors, errors.New("`http.Handler` isn't set yet"))
		return result
	}

	b := bytes.NewBufferString(opts.Body)
	res := httptest.NewRecorder()
	req, err := http.NewRequest(opts.Method, url, b)

	if err != nil {
		result.Errors = []error{err}
		return result
	}

	req.Header = opts.Headers
	req.Header.Set("X-Forwarded-For", "<local>")
	server.ServeHTTP(res, req)
	result.Status = res.Code
	result.Headers = res.Header()
	result.Body = res.Body.String()
	return result
}
