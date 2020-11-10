package destinations

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/events"
)

//Unit holds storage bundle for closing at once
type Unit struct {
	eventQueue *events.PersistentQueue
	storage    events.StorageProxy

	tokenIds []string
	hash     string
}

//Close eventsQueue if exists and storage
func (u *Unit) Close() (multiErr error) {
	if err := u.storage.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	if u.eventQueue != nil {
		if err := u.eventQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing events queue: %v", err))
		}
	}
	return
}
