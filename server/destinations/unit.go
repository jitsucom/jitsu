package destinations

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/storages"
)

//Unit holds storage bundle for closing at once
type Unit struct {
	eventQueue events.Queue
	storage    storages.StorageProxy

	tokenIDs []string
	hash     uint64
}

//CloseStorage runs storages.StorageProxy Close()
//returns err if occurred
func (u *Unit) CloseStorage() error {
	return u.storage.Close()
}

//Close closes storage and eventsQueue if exists
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

//NewTestUnit returns test unit with test storage. Only for tests
func NewTestUnit(storage storages.StorageProxy) *Unit {
	return &Unit{storage: storage}
}
