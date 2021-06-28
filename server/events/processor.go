package events

import (
	"net/http"
)

const (
	APIPreprocessorType     = "api"
	JSPreprocessorType      = "js"
	PixelPreprocessorType   = "pixel"
	SegmentPreprocessorType = "segment"
)

// Processor is used in preprocessing and postprocessing events before and after consuming(storing)
type Processor interface {
	Preprocess(event Event, r *http.Request)
	Postprocess(event Event, eventID string, destinationIDs []string)
	Type() string
}
