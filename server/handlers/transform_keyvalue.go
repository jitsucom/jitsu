package handlers

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"net/http"
	"strconv"
)

// TransformKeyValueHandler is a handler for getting and setting variables in meta storage from destination transformation code
type TransformKeyValueHandler struct {
	templatesStorage templates.Storage
}

func NewTransformKeyValueHandler(templatesStorage templates.Storage) *TransformKeyValueHandler {
	return &TransformKeyValueHandler{templatesStorage: templatesStorage}
}

func (t *TransformKeyValueHandler) GetHandler(c *gin.Context) {
	destinationId := c.Query("destination_id")
	if destinationId == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'destinationId' is required query parameter"))
		return
	}
	key := c.Query("key")
	if key == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'key' is required query parameter"))
		return
	}

	value, err := t.templatesStorage.GetTransformValue(destinationId, key)
	if err != nil {
		logging.Errorf("[%s] Error getting transform value for key: %s : %v", destinationId, key, err)
		_ = c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	if value != nil {
		c.String(http.StatusOK, *value)
	} else {
		c.Status(http.StatusNoContent)
	}
}

func (t *TransformKeyValueHandler) SetHandler(c *gin.Context) {
	destinationId := c.Query("destination_id")
	if destinationId == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'destinationId' is required query parameter"))
		return
	}
	key := c.Query("key")
	if key == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'key' is required query parameter"))
		return
	}
	var ttlMs *int64
	ttl := c.Query("ttl_ms")
	if ttl != "" {
		ms, err := strconv.ParseInt(ttl, 10, 64)
		if err != nil {
			_ = c.AbortWithError(http.StatusBadRequest, fmt.Errorf("'ttl_ms' is not a valid integer: %w", err))
			return
		}
		ttlMs = &ms
	}
	data, err := c.GetRawData()
	if err != nil {
		_ = c.AbortWithError(http.StatusBadRequest, err)
		return
	}

	err = t.templatesStorage.SetTransformValue(destinationId, key, string(data), ttlMs)
	if err != nil {
		logging.Errorf("[%s] Error setting transform value for key: %s ttl_ms: %d: %v", destinationId, key, *ttlMs, err)
		_ = c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	c.Status(http.StatusOK)
}

func (t *TransformKeyValueHandler) DeleteHandler(c *gin.Context) {
	destinationId := c.Query("destination_id")
	if destinationId == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'destinationId' is required query parameter"))
		return
	}
	key := c.Query("key")
	if key == "" {
		_ = c.AbortWithError(http.StatusBadRequest, errors.New("'key' is required query parameter"))
		return
	}

	err := t.templatesStorage.DeleteTransformValue(destinationId, key)
	if err != nil {
		logging.Errorf("[%s] Error deleting transform value for key: %s : %v", destinationId, key, err)
		_ = c.AbortWithError(http.StatusInternalServerError, err)
		return
	}
	c.Status(http.StatusOK)
}
