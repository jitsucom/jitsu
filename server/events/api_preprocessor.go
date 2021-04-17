package events

import (
	"net/http"
)

//APIPreprocessor preprocess server 2 server integration events
type APIPreprocessor struct {
}

func NewAPIPreprocessor() Preprocessor {
	return &APIPreprocessor{}
}

//Preprocess
//put src = api
func (ap *APIPreprocessor) Preprocess(event Event, r *http.Request) {
	event[SrcKey] = "api"
}
