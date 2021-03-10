package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/sources"
	"github.com/jitsucom/eventnative/synchronization"
	"github.com/jitsucom/eventnative/timestamp"
	"net/http"
	"time"
)

type TaskIdResponse struct {
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
	taskId := c.Param("taskId")
	if taskId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'task_id' is required path parameter"})
		return
	}

	task, err := sh.taskService.GetTask(taskId)
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Sync Task gathering failed", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, task)
}

func (sh *TaskHandler) GetAllHandler(c *gin.Context) {
	sourceId := c.Query("source")
	if sourceId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'source' is required query parameter"})
		return
	}

	source, err := sh.sourceService.GetSource(sourceId)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error getting source", Error: err.Error()})
		return
	}

	startStr := c.Query("start")
	if startStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'start' is required query parameter"})
		return
	}

	start, err := time.Parse(time.RFC3339Nano, startStr)
	if err != nil {
		logging.Errorf("Error parsing 'start' query param [%s] in tasks handler: %v", startStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing 'start' query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
	}

	endStr := c.Query("end")
	if endStr == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'end' is required query parameter"})
		return
	}

	end, err := time.Parse(time.RFC3339Nano, endStr)
	if err != nil {
		logging.Errorf("Error parsing 'end' query param [%s] in tasks handler: %v", endStr, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing 'end' query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
		return
	}

	var statusFilter *synchronization.Status
	status := c.Query("status")
	if status != "" {
		status, err := synchronization.StatusFromString(status)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing 'status' query parameter", Error: err.Error()})
			return
		}
		statusFilter = &status
	}

	collectionIdFilter := extractCollectionId(source.SourceType, c)

	var collectionsFilter []string
	if collectionIdFilter == "" {
		collections, err := sh.sourceService.GetCollections(sourceId)
		if err != nil {
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error getting source collections", Error: err.Error()})
			return
		}

		collectionsFilter = append(collectionsFilter, collections...)
	} else {
		collectionsFilter = append(collectionsFilter, collectionIdFilter)
	}

	tasks := []synchronization.TaskDto{}
	for _, collection := range collectionsFilter {
		tasksPerCollection, err := sh.taskService.GetTasks(sourceId, collection, statusFilter, start, end)
		if err != nil {
			logging.Error(err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Task gathering failed", Error: err.Error()})
			return
		}

		tasks = append(tasks, tasksPerCollection...)
	}

	c.JSON(http.StatusOK, TasksResponse{Tasks: tasks})
}

func (sh *TaskHandler) TaskLogsHandler(c *gin.Context) {
	var err error
	taskId := c.Param("taskId")
	if taskId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'task_id' is required path parameter"})
		return
	}

	start := time.Time{}
	startStr := c.Query("start")
	if startStr != "" {
		start, err = time.Parse(time.RFC3339Nano, startStr)
		if err != nil {
			logging.Errorf("Error parsing 'start' query param [%s] in task logs handler: %v", startStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing 'start' query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
			return
		}
	}

	end := time.Now().UTC()
	endStr := c.Query("end")
	if endStr != "" {
		end, err = time.Parse(time.RFC3339Nano, endStr)
		if err != nil {
			logging.Errorf("Error parsing 'end' query param [%s] in task logs handler: %v", endStr, err)
			c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error parsing 'end' query parameter. Accepted datetime format: " + timestamp.Layout, Error: err.Error()})
			return
		}
	}

	logRecords, err := sh.taskService.GetTaskLogs(taskId, start, end)
	if err != nil {
		logging.Error(err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Task logs gathering failed", Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TaskLogsResponse{Logs: logRecords})
}

func (sh *TaskHandler) SyncHandler(c *gin.Context) {
	sourceId := c.Query("source")
	if sourceId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'source' is required query parameter"})
		return
	}

	source, err := sh.sourceService.GetSource(sourceId)
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error getting source", Error: err.Error()})
		return
	}

	collectionId := extractCollectionId(source.SourceType, c)
	if collectionId == "" {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "'collection' is required query parameter"})
		return
	}

	taskId, err := sh.taskService.Sync(sourceId, collectionId)
	if err != nil {
		if err == synchronization.ErrSourceCollectionIsSyncing {
			c.JSON(http.StatusOK, TaskIdResponse{ID: taskId})
			return
		}

		if err == synchronization.ErrSourceCollectionIsStartingToSync {
			c.JSON(http.StatusConflict, middleware.ErrorResponse{Message: "Sync Task creation failed", Error: err.Error()})
			return
		}

		logging.Errorf("Error sync source [%s] collection [%s]: %v", sourceId, collectionId, err)
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Sync Task creation failed", Error: err.Error()})
		return
	}

	c.JSON(http.StatusCreated, TaskIdResponse{ID: taskId})
}

func extractCollectionId(sourceType string, c *gin.Context) string {
	if sourceType == drivers.SingerType {
		return drivers.DefaultSingerCollection
	}
	return c.Query("collection")
}
