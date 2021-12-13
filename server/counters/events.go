package counters

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/safego"
	"sync"
	"time"
)

var (
	eventsInstance *Events
)

type Key struct {
	namespace, id, eventType, status string
}

type Events struct {
	storage meta.Storage

	mutex  *sync.RWMutex
	buffer map[Key]int64

	closed chan struct{}
}

func InitEvents(storage meta.Storage) {
	eventsInstance = &Events{
		storage: storage,
		mutex:   &sync.RWMutex{},
		buffer:  map[Key]int64{},
		closed:  make(chan struct{}),
	}
	safego.Run(eventsInstance.startPersisting)
}

func (e *Events) startPersisting() {
	ticker := time.NewTicker(5 * time.Second)
	for {
		select {
		case <-e.closed:
			e.persist()
			return
		case <-ticker.C:
			e.persist()
		}
	}
}

//persist extract values from the buffer and persist them. Leave buffer empty
func (e *Events) persist() {
	bufCopy := map[Key]int64{}

	//extract
	e.mutex.Lock()
	for k, v := range e.buffer {
		bufCopy[k] = v
	}
	e.buffer = map[Key]int64{}
	e.mutex.Unlock()

	//persist
	for key, value := range bufCopy {
		if err := e.storage.IncrementEventsCount(key.id, key.namespace, key.eventType, key.status, timestamp.Now().UTC(), value); err != nil {
			logging.SystemErrorf("Error updating %s [%s] events [%s] counter id=[%s] value [%d]: %v", key.status, key.eventType, key.namespace, key.id, value, err)
		}
	}
}

func (e *Events) event(id, namespace, eventType, status string, value int64) {
	if e == nil {
		return
	}

	k := Key{
		namespace: namespace,
		id:        id,
		eventType: eventType,
		status:    status,
	}

	e.mutex.Lock()
	e.buffer[k] += value
	e.mutex.Unlock()
}

//SuccessPushSourceEvents increments:
// deprecated source events deprecated push source events
// new push source counters
func SuccessPushSourceEvents(sourceID string, value int64) {
	//536-issue DEPRECATED
	successEvents(sourceID, meta.SourceNamespace, "", value)
	//536-issue DEPRECATED
	successEvents(sourceID, meta.PushSourceNamespace, "", value)

	successEvents(sourceID, meta.SourceNamespace, meta.PushEventType, value)
}

//SuccessPullSourceEvents increments:
// deprecated source events
// new pull source counters
func SuccessPullSourceEvents(sourceID string, value int64) {
	//536-issue DEPRECATED
	successEvents(sourceID, meta.SourceNamespace, "", value)

	successEvents(sourceID, meta.SourceNamespace, meta.PullEventType, value)
}

//SuccessPushDestinationEvents increments:
// deprecated destination events
// new push destination counters
func SuccessPushDestinationEvents(destinationID string, value int64) {
	//536-issue DEPRECATED
	successEvents(destinationID, meta.DestinationNamespace, "", value)

	successEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

//SuccessPullDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func SuccessPullDestinationEvents(destinationID string, value int64) {
	//536-issue DEPRECATED
	successEvents(destinationID, meta.DestinationNamespace, "", value)

	successEvents(destinationID, meta.DestinationNamespace, meta.PullEventType, value)
}

func successEvents(id, namespace, eventType string, value int64) {
	eventsInstance.event(id, namespace, eventType, meta.SuccessStatus, value)
}

//ErrorPullSourceEvents increments:
// new pull sources counters
func ErrorPullSourceEvents(sourceID string, value int64) {
	errorEvents(sourceID, meta.SourceNamespace, meta.PullEventType, value)
}

//ErrorPullDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func ErrorPullDestinationEvents(destinationID string, value int64) {
	//536-issue DEPRECATED
	errorEvents(destinationID, meta.DestinationNamespace, "", value)

	errorEvents(destinationID, meta.DestinationNamespace, meta.PullEventType, value)
}

//ErrorPushDestinationEvents increments:
// deprecated destination events
// new pull destination counters
func ErrorPushDestinationEvents(destinationID string, value int64) {
	//536-issue DEPRECATED
	errorEvents(destinationID, meta.DestinationNamespace, "", value)

	errorEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

func errorEvents(id, namespace, eventType string, value int64) {
	eventsInstance.event(id, namespace, eventType, meta.ErrorStatus, value)
}

//SkipPushSourceEvents increments:
// deprecated source events
// new push source counters
func SkipPushSourceEvents(sourceID string, value int64) {
	//536-issue DEPRECATED
	skipEvents(sourceID, meta.SourceNamespace, "", value)
	//536-issue DEPRECATED
	skipEvents(sourceID, meta.PushSourceNamespace, "", value)

	skipEvents(sourceID, meta.SourceNamespace, meta.PushEventType, value)
}

func SkipPushDestinationEvents(destinationID string, value int64) {
	//536-issue DEPRECATED
	skipEvents(destinationID, meta.DestinationNamespace, "", value)

	skipEvents(destinationID, meta.DestinationNamespace, meta.PushEventType, value)
}

func skipEvents(id, namespace, eventType string, value int64) {
	eventsInstance.event(id, namespace, eventType, meta.SkipStatus, value)
}

func Close() {
	if eventsInstance != nil {
		close(eventsInstance.closed)
	}
}
