package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"strings"
)

const rawJSONFormat = "raw_json"

type FallbackFilesResponse struct {
	Files []*fallback.FileStatus `json:"files"`
}

type ReplayRequest struct {
	FileName      string `json:"file_name"`
	DestinationID string `json:"destination_id"`
	FileFormat    string `json:"file_format"`
	SkipMalformed bool   `json:"skip_malformed"`
}

type FallbackHandler struct {
	fallbackService *fallback.Service
}

func NewFallbackHandler(fallbackService *fallback.Service) *FallbackHandler {
	return &FallbackHandler{fallbackService: fallbackService}
}

func (fh *FallbackHandler) GetHandler(c *gin.Context) {
	destinationIDs := c.Query("destination_ids")
	destinationsFilter := map[string]bool{}
	if destinationIDs != "" {
		for _, destinationID := range strings.Split(destinationIDs, ",") {
			destinationsFilter[destinationID] = true
		}
	}

	fileStatuses := fh.fallbackService.GetFileStatuses(destinationsFilter)

	c.JSON(http.StatusOK, FallbackFilesResponse{Files: fileStatuses})
}

func (fh *FallbackHandler) ReplayHandler(c *gin.Context) {
	req := &ReplayRequest{}
	if err := c.BindJSON(req); err != nil {
		logging.Errorf("Error parsing replay body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to parse body", err))
		return
	}

	err := fh.fallbackService.Replay(req.FileName, req.DestinationID, req.FileFormat == rawJSONFormat, req.SkipMalformed)
	if err != nil {
		logging.Errorf("Error replaying file: [%s] from fallback: %v", req.FileName, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Failed to replay file: "+req.FileName, err))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}
