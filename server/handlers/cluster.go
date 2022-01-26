package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

//ClusterInfo is a dto for Cluster info response
type ClusterInfo struct {
	Instances []InstanceInfo `json:"instances"`
}

//InstanceInfo is a dto for server name
type InstanceInfo struct {
	Name string `json:"name"`
}

//ClusterHandler handles cluster info requests
type ClusterHandler struct {
	coordinationService *coordination.Service
}

//NewClusterHandler returns configured ClusterHandler instance
func NewClusterHandler(coordinationService *coordination.Service) *ClusterHandler {
	return &ClusterHandler{
		coordinationService: coordinationService,
	}
}

//Handler returns all jitsu server instances names from current cluster
func (ch *ClusterHandler) Handler(c *gin.Context) {
	instanceNames, err := ch.coordinationService.GetJitsuInstancesInCluster()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrResponse("Error getting cluster info", err))
		return
	}

	instances := []InstanceInfo{}
	for _, name := range instanceNames {
		instances = append(instances, InstanceInfo{Name: name})
	}

	c.JSON(http.StatusOK, ClusterInfo{Instances: instances})
}
