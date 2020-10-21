package synchronization

import (
	"github.com/ksensehq/eventnative/storages"
	"io"
)

//Dummy implementation for Service
type Dummy struct {
	serverNameSingleArray []string
}

func (d *Dummy) GetInstances() ([]string, error) {
	return d.serverNameSingleArray, nil
}

func (d *Dummy) Lock(destinationName string, tableName string) (storages.Lock, io.Closer, error) {
	return nil, nil, nil
}

func (d *Dummy) Unlock(lock storages.Lock, closer io.Closer) error {
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
