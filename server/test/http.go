package test

import (
	"github.com/hashicorp/go-multierror"
	"net/http"
	"time"
)

const retryCount = 3
const wait = time.Second * 1

//RenewGet executes HTTP GET requests with retry and timeout
func RenewGet(url string) (*http.Response, error) {
	var multiErr error
	for i := 0; i < retryCount; i++ {
		resp, err := http.Get(url)
		if err == nil {
			return resp, nil
		}
		multiErr = multierror.Append(multiErr, err)
		time.Sleep(wait)
	}
	return nil, multiErr

}
