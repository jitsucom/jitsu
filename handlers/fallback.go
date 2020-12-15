package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/fallback"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"net/http"
	"strings"
)

const rawJsonFormat = "raw_json"

type FallbackFilesResponse struct {
	Files []*fallback.FileStatus `json:"files"`
}

type ReplayRequest struct {
	FileName      string `json:"file_name"`
	DestinationId string `json:"destination_id"`
	FileFormat    string `json:"file_format"`
}

type FallbackHandler struct {
	fallbackService *fallback.Service
}

func NewFallbackHandler(fallbackService *fallback.Service) *FallbackHandler {
	return &FallbackHandler{fallbackService: fallbackService}
}

func (fh *FallbackHandler) GetHandler(c *gin.Context) {
	destinationIds := c.Query("destination_ids")
	destinationsFilter := map[string]bool{}
	if destinationIds != "" {
		for _, destinationId := range strings.Split(destinationIds, ",") {
			destinationsFilter[destinationId] = true
		}
	}

	fileStatuses := fh.fallbackService.GetFileStatuses(destinationsFilter)

	c.JSON(http.StatusOK, FallbackFilesResponse{Files: fileStatuses})
}

func (fh *FallbackHandler) ReplayHandler(c *gin.Context) {
	req := &ReplayRequest{}
	if err := c.BindJSON(req); err != nil {
		logging.Errorf("Error parsing replay body: %v", err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to parse body", Error: err.Error()})
		return
	}

	err := fh.fallbackService.Replay(req.FileName, req.DestinationId, req.FileFormat == rawJsonFormat)
	if err != nil {
		logging.Errorf("Error replaying file: [%s] from fallback: %v", req.FileName, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Failed to replay file: " + req.FileName, Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, middleware.OkResponse())
}
