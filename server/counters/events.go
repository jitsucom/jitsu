package counters

import (
	"github.com/jitsucom/eventnative/server/logging"
	"github.com/jitsucom/eventnative/server/meta"
	"time"
)

var (
	eventsInstance *Events
)

type Events struct {
	storage meta.Storage
}

func InitEvents(storage meta.Storage) {
	eventsInstance = &Events{storage: storage}
}

func SuccessSourceEvents(sourceId string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SuccessEvents(sourceId, meta.SourceNamespace, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success events counter source [%s] value [%d]: %v", sourceId, value, err)
	}
}

func SuccessEvents(destinationId string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SuccessEvents(destinationId, meta.DestinationNamespace, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success events counter destination [%s] value [%d]: %v", destinationId, value, err)
	}
}

func ErrorEvents(destinationId string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.ErrorEvents(destinationId, meta.DestinationNamespace, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating error events counter destination [%s] value [%d]: %v", destinationId, value, err)
	}
}

func SkipEvents(destinationId string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SkipEvents(destinationId, meta.DestinationNamespace, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating skipped events counter destination [%s] value [%d]: %v", destinationId, value, err)
	}
}
