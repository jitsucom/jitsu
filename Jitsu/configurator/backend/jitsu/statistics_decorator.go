package jitsu

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
)

type StatisticsDecorator struct{}

func NewStatisticsDecorator() *StatisticsDecorator {
	return &StatisticsDecorator{}
}

func (sd *StatisticsDecorator) Decorate(c *gin.Context) (*Request, error) {
	projectID := c.Query(middleware.ProjectIDQuery)
	destinationID := c.Query("destination_id")
	if destinationID == "" {
		return BuildRequest(c), nil
	}

	return BuildRequestWithQueryParams(c, map[string]string{"destination_id": projectID + "." + destinationID}), nil
}
