package counters

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
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

func SuccessSourceEvents(sourceID string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SuccessEvents(sourceID, meta.SourceNamespace, timestamp.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success events counter source [%s] value [%d]: %v", sourceID, value, err)
	}
}

func SuccessEvents(destinationID string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SuccessEvents(destinationID, meta.DestinationNamespace, timestamp.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success events counter destination [%s] value [%d]: %v", destinationID, value, err)
	}
}

func ErrorEvents(destinationID string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.ErrorEvents(destinationID, meta.DestinationNamespace, timestamp.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating error events counter destination [%s] value [%d]: %v", destinationID, value, err)
	}
}

func SkipSourceEvents(sourceID string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SkipEvents(sourceID, meta.SourceNamespace, timestamp.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating skip events counter source [%s] value [%d]: %v", sourceID, value, err)
	}
}

func SkipEvents(destinationID string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SkipEvents(destinationID, meta.DestinationNamespace, timestamp.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating skipped events counter destination [%s] value [%d]: %v", destinationID, value, err)
	}
}
