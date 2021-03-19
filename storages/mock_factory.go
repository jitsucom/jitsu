package storages

import (
	"github.com/jitsucom/eventnative/events"
)

type testProxyMock struct {
}

func (tpm *testProxyMock) Get() (Storage, bool) {
	return nil, false
}

func (tpm *testProxyMock) Close() error {
	return nil
}

type MockFactory struct {
}

func NewMockFactory() Factory {
	return &MockFactory{}
}

func (mf *MockFactory) Create(name string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error) {
	var eventQueue *events.PersistentQueue
	if destination.Mode == StreamMode {
		eventQueue, _ = events.NewPersistentQueue(name, name, "/tmp")
	}
	return &testProxyMock{}, eventQueue, nil
}
