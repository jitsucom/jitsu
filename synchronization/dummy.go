package synchronization

import (
	"github.com/ksensehq/eventnative/storages"
)

type DummyLock struct {
}

func (d *DummyLock) Unlock() {
}

func (d *DummyLock) Identifier() string {
	return ""
}

//Dummy implementation for Service
type Dummy struct {
	serverNameSingleArray []string
}

func (d *Dummy) GetInstances() ([]string, error) {
	return d.serverNameSingleArray, nil
}

func (d *Dummy) Lock(destinationName string, tableName string) (storages.Lock, error) {
	return &DummyLock{}, nil
}

func (d *Dummy) Unlock(lock storages.Lock) error {
	return nil
}

func (d *Dummy) GetVersion(destinationName string, tableName string) (int64, error) {
	return 1, nil
}

func (d *Dummy) IncrementVersion(destinationName string, tableName string) (int64, error) {
	return 1, nil
}

func (d *Dummy) Close() error {
	return nil
}
