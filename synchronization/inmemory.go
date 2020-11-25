package synchronization

import (
	"fmt"
	"github.com/jitsucom/eventnative/storages"
	"sync"
)

type InMemoryLock struct {
	identifier string
}

func (iml *InMemoryLock) Unlock() {
}

func (iml *InMemoryLock) Identifier() string {
	return iml.identifier
}

//InMemoryService implementation for Service
type InMemoryService struct {
	serverNameSingleArray []string

	//for locking in single en node setup
	locks *sync.Map
}

func NewInMemoryService(serverNameSingleArray []string) *InMemoryService {
	return &InMemoryService{serverNameSingleArray: serverNameSingleArray, locks: &sync.Map{}}
}

func (ims *InMemoryService) GetInstances() ([]string, error) {
	return ims.serverNameSingleArray, nil
}

func (ims *InMemoryService) Lock(system string, collection string) (storages.Lock, error) {
	identifier := system + "_" + collection
	_, loaded := ims.locks.LoadOrStore(identifier, true)
	if loaded {
		return nil, fmt.Errorf("Error in-memory locking [%s] system [%s] collection: already locked", system, collection)
	}

	return &InMemoryLock{identifier: identifier}, nil
}

func (ims *InMemoryService) Unlock(lock storages.Lock) error {
	ims.locks.Delete(lock.Identifier())
	return nil
}

func (ims *InMemoryService) GetVersion(system string, collection string) (int64, error) {
	return 1, nil
}

func (ims *InMemoryService) IncrementVersion(system string, collection string) (int64, error) {
	return 1, nil
}

func (ims *InMemoryService) Close() error {
	return nil
}
