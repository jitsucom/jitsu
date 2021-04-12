package jitsu

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"strings"
)

type EventsCacheDecorator struct {
	configurationsProvider *storages.ConfigurationsService
}

func NewEventsCacheDecorator(configurationsProvider *storages.ConfigurationsService) *EventsCacheDecorator {
	return &EventsCacheDecorator{configurationsProvider: configurationsProvider}
}

func (ecd *EventsCacheDecorator) Decorate(c *gin.Context) (*Request, error) {
	projectID := c.GetString(middleware.ProjectIDKey)
	destinationIDs := c.Query("destination_ids")
	if destinationIDs == "" {
		destinationsObjects, err := ecd.configurationsProvider.GetDestinationsByProjectID(projectID)
		if err != nil {
			return nil, fmt.Errorf("Error getting destinations for [%s] project: %v", projectID, err)
		}

		destinationIDsArray := []string{}
		for _, destinationObject := range destinationsObjects {
			destinationID := projectID + "." + destinationObject.UID
			destinationIDsArray = append(destinationIDsArray, destinationID)
		}

		destinationIDs = strings.Join(destinationIDsArray, ",")
	}

	return BuildRequestWithQueryParams(c, map[string]string{"destination_ids": destinationIDs}), nil
}
