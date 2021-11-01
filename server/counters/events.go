package counters

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
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

//SuccessPushSourceEvents increments:
// deprecated source events deprecated push source events
// new push source counters
func SuccessPushSourceEvents(sourceID string, value int) {
	//536-issue DEPRECATED
	successEvents(sourceID, meta.SourceNamespace, "", value)
	//536-issue DEPRECATED
	successEvents(sourceID, meta.PushSourceNamespace, "", value)

	successEvents(sourceID, meta.SourceNamespace, meta.PushEventType, value)
}

//SuccessPullSourceEvents increments:
// deprecated source events
// new pull source counters
func SuccessPullSourceEvents(sourceID string, value int) {
	//536-issue DEPRECATED
	successEvents(sourceID, meta.SourceNamespace, "", value)

	successEvents(sourceID, meta.SourceNamespace, meta.PullEventType, value)
}

//SuccessPushDestinationEvents increments:
// deprecated destination events
// new push destination counters
func SuccessPushDestinationEvents(destinationID string, value int) {
	//536-issue DEPRECATED
	successEvents(destinationID, meta.DestinationNamespace, "", value)

	successEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

//SuccessPullDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func SuccessPullDestinationEvents(destinationID string, value int) {
	//536-issue DEPRECATED
	successEvents(destinationID, meta.DestinationNamespace, "", value)

	successEvents(destinationID, meta.DestinationNamespace, meta.PullEventType, value)
}

func successEvents(id, namespace, eventType string, value int) {
	if eventsInstance == nil {
		return
	}

	err := eventsInstance.storage.SuccessEvents(id, namespace, eventType, time.Now().UTC(), value)
	if err != nil {
		logging.SystemErrorf("Error updating success [%s] events [%s] counter id=[%s] value [%d]: %v", eventType, namespace, id, value, err)
	}
}

//ErrorPullSourceEvents increments:
// new pull sources counters
func ErrorPullSourceEvents(sourceID string, value int) {
	errorEvents(sourceID, meta.SourceNamespace, meta.PullEventType, value)
}

//ErrorPullDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func ErrorPullDestinationEvents(destinationID string, value int) {
	//536-issue DEPRECATED
	errorEvents(destinationID, meta.DestinationNamespace, "", value)

	errorEvents(destinationID, meta.DestinationNamespace, meta.PullEventType, value)
}

//ErrorPushDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func ErrorPushDestinationEvents(destinationID string, value int) {
	//536-issue DEPRECATED
	errorEvents(destinationID, meta.DestinationNamespace, "", value)

	errorEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

func errorEvents(id, namespace, eventType string, value int) {
	if eventsInstance == nil {
		return
	}

	if err := eventsInstance.storage.ErrorEvents(id, namespace, eventType, time.Now().UTC(), value); err != nil {
		logging.SystemErrorf("Error updating error [%s] events [%s] counter id=[%s] value [%d]: %v", eventType, namespace, id, value, err)
	}
}

//SkipPushSourceEvents increments:
// deprecated source events
// new push source counters
func SkipPushSourceEvents(sourceID string, value int) {
	//536-issue DEPRECATED
	skipEvents(sourceID, meta.SourceNamespace, "", value)
	//536-issue DEPRECATED
	skipEvents(sourceID, meta.PushSourceNamespace, "", value)

	skipEvents(sourceID, meta.SourceNamespace, meta.PushEventType, value)
}

func SkipPushDestinationEvents(destinationID string, value int) {
	//536-issue DEPRECATED
	skipEvents(destinationID, meta.DestinationNamespace, "", value)

	skipEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

func skipEvents(id, namespace, eventType string, value int) {
	if eventsInstance == nil {
		return
	}

	if err := eventsInstance.storage.SkipEvents(id, namespace, eventType, time.Now().UTC(), value); err != nil {
		logging.SystemErrorf("Error updating skip [%s] events [%s] counter id=[%s] value [%d]: %v", eventType, namespace, id, value, err)
	}
}
