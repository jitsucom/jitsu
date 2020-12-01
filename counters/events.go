package counters

import (
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"time"
)

var eventsInstance *Events

type Events struct {
	storage meta.Storage
}

func InitEvents(storage meta.Storage) {
	eventsInstance = &Events{storage: storage}
}

func SuccessEvents(destinationId string, value int) {
	if eventsInstance == nil {
		logging.Warnf("Counters instance isn't configured!")
		return
	}

	err := eventsInstance.storage.SuccessEvents(destinationId, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success events counter destination [%s] value [%d]: %v", destinationId, value, err)
	}
}

func ErrorEvents(destinationId string, value int) {
	if eventsInstance == nil {
		logging.Warnf("Counters instance isn't configured!")
		return
	}

	err := eventsInstance.storage.ErrorEvents(destinationId, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating error events counter destination [%s] value [%d]: %v", destinationId, value, err)
	}
}
