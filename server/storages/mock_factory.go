package storages

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
)

//Mock proxy
type testProxyMock struct{}

//Get is a mock func
func (tpm *testProxyMock) Get() (Storage, bool) { return nil, false }

//GetUniqueIDField is a mock func
func (tpm *testProxyMock) GetUniqueIDField() *identifiers.UniqueID {
	return appconfig.Instance.GlobalUniqueIDField
}

//ID is a mock func
func (tpm *testProxyMock) ID() string { return "" }

//Close is a mock func
func (tpm *testProxyMock) Close() error { return nil }

//IsCachingDisabled is a mock func
func (tpm *testProxyMock) IsCachingDisabled() bool { return false }

//MockFactory is a Mock destinations storages factory
type MockFactory struct{}

//NewMockFactory returns new MockFactory
func NewMockFactory() Factory { return &MockFactory{} }

//Create returns proxy Mock and events queue
func (mf *MockFactory) Create(id string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error) {
	var eventQueue *events.PersistentQueue
	if destination.Mode == StreamMode {
		eventQueue, _ = events.NewPersistentQueue(id, id, "/tmp")
	}
	return &testProxyMock{}, eventQueue, nil
}
