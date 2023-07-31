package jitsu

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/meta"
	"strings"
)

type EventsCacheDecorator struct {
	configurationsProvider *storages.ConfigurationsService
}

func NewEventsCacheDecorator(configurationsProvider *storages.ConfigurationsService) *EventsCacheDecorator {
	return &EventsCacheDecorator{configurationsProvider: configurationsProvider}
}

func (ecd *EventsCacheDecorator) Decorate(c *gin.Context) (*Request, error) {
	var err error

	projectID := c.Query(middleware.ProjectIDQuery)
	ids := c.Query("ids")
	namespace := c.Query("namespace")
	if namespace == "" {
		namespace = meta.EventsDestinationNamespace
	}

	status := c.Query("status")
	if status != "" && status != meta.EventsErrorStatus {
		return nil, fmt.Errorf("status query parameter can be only %q or not specified. Current value: %s", meta.EventsErrorStatus, status)
	}

	if ids == "" {
		if namespace == meta.EventsDestinationNamespace {
			ids, err = ecd.getProjectDestinations(projectID)
			if err != nil {
				return nil, err
			}
		} else if namespace == meta.EventsTokenNamespace {
			ids, err = ecd.getProjectAPIKeys(projectID)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, fmt.Errorf("unknown namespace: %s. Only %s and %s are supported", namespace, meta.EventsDestinationNamespace, meta.EventsTokenNamespace)
		}
	}

	return BuildRequestWithQueryParams(c, map[string]string{"ids": ids, "namespace": namespace, "status": status}), nil
}

func (ecd *EventsCacheDecorator) getProjectDestinations(projectID string) (string, error) {
	destinationsObjects, err := ecd.configurationsProvider.GetDestinationsByProjectID(projectID)
	if err != nil {
		return "", fmt.Errorf("Error getting destinations for [%s] project: %v", projectID, err)
	}

	destinationIDsArray := []string{}
	for _, destinationObject := range destinationsObjects {
		destinationID := projectID + "." + destinationObject.UID
		destinationIDsArray = append(destinationIDsArray, destinationID)
	}

	return strings.Join(destinationIDsArray, ","), nil
}

func (ecd *EventsCacheDecorator) getProjectAPIKeys(projectID string) (string, error) {
	apiKeysObjects, err := ecd.configurationsProvider.GetAPIKeysByProjectID(projectID)
	if err != nil {
		return "", fmt.Errorf("Error getting api keys for [%s] project: %v", projectID, err)
	}

	apiKeysIDsArray := []string{}
	for _, apiKeyObject := range apiKeysObjects {
		apiKeysIDsArray = append(apiKeysIDsArray, apiKeyObject.ID)
	}

	return strings.Join(apiKeysIDsArray, ","), nil
}
