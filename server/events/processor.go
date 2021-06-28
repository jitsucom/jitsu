package events

import (
	"github.com/gin-gonic/gin"
)

const (
	APIPreprocessorType     = "api"
	JSPreprocessorType      = "js"
	PixelPreprocessorType   = "pixel"
	SegmentPreprocessorType = "segment"
)

// Processor is used in preprocessing and postprocessing events before and after consuming(storing)
type Processor interface {
	Preprocess(event Event, c *gin.Context)
	Postprocess(event Event, eventID string, destinationIDs []string)
	Type() string
}
