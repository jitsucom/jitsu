package destinations

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/server/events"
	"github.com/jitsucom/eventnative/server/storages"
)

//Unit holds storage bundle for closing at once
type Unit struct {
	eventQueue *events.PersistentQueue
	storage    storages.StorageProxy

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
