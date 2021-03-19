package events

import (
	"net/http"
)

//ApiPreprocessor preprocess server 2 server integration events
type ApiPreprocessor struct {
}

func NewApiPreprocessor() Preprocessor {
	return &ApiPreprocessor{}
}

//Preprocess
//put src = api
func (ap *ApiPreprocessor) Preprocess(event Event, r *http.Request) {
	event["src"] = "api"
}
