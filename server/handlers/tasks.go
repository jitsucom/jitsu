package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/drivers"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/timestamp"
	"net/http"
	"strconv"
	"time"
)

type TaskIDResponse struct {
	ID string `json:"task_id"`
}

type TasksResponse struct {
	Tasks []synchronization.TaskDto `json:"tasks"`
}

type TaskLogsResponse struct {
	Logs []synchronization.LogRecordDto `json:"logs"`
}

type TaskHandler struct {
	taskService   *synchronization.TaskService
	sourceService *sources.Service
}

func NewTaskHandler(taskService *synchronization.TaskService, sourceService *sources.Service) *TaskHandler {
	return &TaskHandler{taskService: taskService, sourceService: sourceService}
}

func (sh *TaskHandler) GetByIDHandler(c *gin.Context) {
	taskID := c.Param("taskID")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'task_id' is required path parameter", nil))
		return
	}

	task, err := sh.taskService.GetTask(taskID)
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Tasks gathering failed", err))
		return
	}

	c.JSON(http.StatusOK, task)
}

func (sh *TaskHandler) GetAllHandler(c *gin.Context) {
	sourceID := c.Query("source")
	if sourceID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'source' is required query parameter", nil))
		return
	}

	source, err := sh.sourceService.GetSource(sourceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error getting source", err))
		return
	}

	startStr := c.Query("start")
	if startStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'start' is required query parameter", nil))
		return
	}

	start, err := time.Parse(time.RFC3339Nano, startStr)
	if err != nil {
		logging.Errorf("Error parsing 'start' query param [%s] in tasks handler: %v", startStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing 'start' query parameter. Accepted datetime format: "+timestamp.Layout, err))
		return
	}

	endStr := c.Query("end")
	if endStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'end' is required query parameter", nil))
		return
	}

	end, err := time.Parse(time.RFC3339Nano, endStr)
	if err != nil {
		logging.Errorf("Error parsing 'end' query param [%s] in tasks handler: %v", endStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing 'end' query parameter. Accepted datetime format: "+timestamp.Layout, err))
		return
	}

	var statusFilter *synchronization.Status
	status := c.Query("status")
	if status != "" {
		status, err := synchronization.StatusFromString(status)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing 'status' query parameter", err))
			return
		}
		statusFilter = &status
	}

	collectionIDFilter := extractCollectionID(source.SourceType, c)

	var collectionsFilter []string
	if collectionIDFilter == "" {
		collections, err := sh.sourceService.GetCollections(sourceID)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error getting source collections", err))
			return
		}

		collectionsFilter = append(collectionsFilter, collections...)
	} else {
		collectionsFilter = append(collectionsFilter, collectionIDFilter)
	}

	limitStr := c.Query("limit")
	var limit int
	if limitStr == "" {
		limit = 0
	} else {
		limit, err = strconv.Atoi(limitStr)
		if err != nil {
			logging.Errorf("Error parsing limit [%s] to int in task handler: %v", limitStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("[limit] must be int", err))
			return
		}
	}

	tasks := []synchronization.TaskDto{}
	for _, collection := range collectionsFilter {
		tasksPerCollection, err := sh.taskService.GetTasks(sourceID, collection, statusFilter, start, end, limit)
		if err != nil {
			logging.Error(err)
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Tasks gathering failed", err))
			return
		}

		tasks = append(tasks, tasksPerCollection...)
	}

	c.JSON(http.StatusOK, TasksResponse{Tasks: tasks})
}

func (sh *TaskHandler) TaskLogsHandler(c *gin.Context) {
	var err error
	taskID := c.Param("taskID")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'task_id' is required path parameter", nil))
		return
	}

	start := time.Time{}
	startStr := c.Query("start")
	if startStr != "" {
		start, err = time.Parse(time.RFC3339Nano, startStr)
		if err != nil {
			logging.Errorf("Error parsing 'start' query param [%s] in task logs handler: %v", startStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing 'start' query parameter. Accepted datetime format: "+timestamp.Layout, err))
			return
		}
	}

	end := timestamp.Now().UTC()
	endStr := c.Query("end")
	if endStr != "" {
		end, err = time.Parse(time.RFC3339Nano, endStr)
		if err != nil {
			logging.Errorf("Error parsing 'end' query param [%s] in task logs handler: %v", endStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error parsing 'end' query parameter. Accepted datetime format: "+timestamp.Layout, err))
			return
		}
	}

	logRecords, err := sh.taskService.GetTaskLogs(taskID, start, end)
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Task logs gathering failed", err))
		return
	}

	c.JSON(http.StatusOK, TaskLogsResponse{Logs: logRecords})
}

func (sh *TaskHandler) SyncHandler(c *gin.Context) {
	sourceID := c.Query("source")
	if sourceID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'source' is required query parameter", nil))
		return
	}

	source, err := sh.sourceService.GetSource(sourceID)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error getting source", err))
		return
	}

	collectionID := extractCollectionID(source.SourceType, c)
	if collectionID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'collection' is required query parameter", nil))
		return
	}

	taskID, err := sh.taskService.Sync(sourceID, collectionID, synchronization.NOW)
	if err != nil {
		if err == synchronization.ErrSourceCollectionIsSyncing {
			c.JSON(http.StatusOK, TaskIDResponse{ID: taskID})
			return
		}

		if err == synchronization.ErrSourceCollectionIsStartingToSync {
			c.JSON(http.StatusConflict, middleware.ErrResponse("Sync Task creation failed", err))
			return
		}

		logging.Errorf("Error sync source [%s] collection [%s]: %v", sourceID, collectionID, err)
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Sync Task creation failed", err))
		return
	}

	c.JSON(http.StatusCreated, TaskIDResponse{ID: taskID})
}

func (sh *TaskHandler) TaskCancelHandler(c *gin.Context) {
	taskID := c.Param("taskID")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("'task_id' is required path parameter", nil))
		return
	}

	err := sh.taskService.CancelTask(taskID)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, middleware.OKResponse())
}

func extractCollectionID(sourceType string, c *gin.Context) string {
	if sourceType == driversbase.SingerType || sourceType == driversbase.AirbyteType || sourceType == driversbase.SdkSourceType {
		return drivers.DefaultCollection
	}
	return c.Query("collection")
}
