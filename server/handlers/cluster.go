package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/cluster"
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
	manager cluster.Manager
}

//NewClusterHandler returns configured ClusterHandler instance
func NewClusterHandler(manager cluster.Manager) *ClusterHandler {
	return &ClusterHandler{
		manager: manager,
	}
}

//Handler returns all jitsu server instances names from current cluster
func (ch *ClusterHandler) Handler(c *gin.Context) {
	instanceNames, err := ch.manager.GetInstances()
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
