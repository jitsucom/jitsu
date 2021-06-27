package events

import (
	"net/http"
)

const (
	JSPreprocessorType      = "js"
	APIPreprocessorType     = "api"
	SegmentPreprocessorType = "segment"
)

// Processor is used in preprocessing and postprocessing events before and after consuming(storing)
type Processor interface {
	Preprocess(event Event, r *http.Request)
	Postprocess(event Event, eventID string, destinationIDs []string)
	Type() string
}
