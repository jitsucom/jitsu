package destinations

import (
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/storages"
)

//map["tokenID"]map["destination_name"]true
type TokenizedIDs map[string]map[string]bool

//map["tokenID"]map["destination_name"]interface
//because 1 token id = ∞ storages
type TokenizedStorages map[string]map[string]storages.StorageProxy

//map["tokenID"]map["tokenID | destination_name"]interface
//because 1 token id = 1logger but ∞ event.queue
type TokenizedConsumers map[string]map[string]events.Consumer

func (ts TokenizedStorages) Add(tokenID, name string, proxy storages.StorageProxy) {
	storageProxies, ok := ts[tokenID]
	if !ok {
		storageProxies = map[string]storages.StorageProxy{}
		ts[tokenID] = storageProxies
	}
	storageProxies[name] = proxy
}

func (ts TokenizedStorages) AddAll(other TokenizedStorages) {
	for tokenID, storages := range other {
		for name, storage := range storages {
			ts.Add(tokenID, name, storage)
		}
	}
}

func (tc TokenizedConsumers) Add(tokenID, name string, proxy events.Consumer) {
	consumers, ok := tc[tokenID]
	if !ok {
		consumers = map[string]events.Consumer{}
		tc[tokenID] = consumers
	}
	consumers[name] = proxy
}

func (tc TokenizedConsumers) AddAll(other TokenizedConsumers) {
	for tokenID, consumers := range other {
		for name, consumer := range consumers {
			tc.Add(tokenID, name, consumer)
		}
	}
}

func (ti TokenizedIDs) Add(tokenID, name string) {
	ids, ok := ti[tokenID]
	if !ok {
		ids = map[string]bool{}
		ti[tokenID] = ids
	}
	ids[name] = true
}

func (ti TokenizedIDs) AddAll(other TokenizedIDs) {
	for tokenID, ids := range other {
		for id := range ids {
			ti.Add(tokenID, id)
		}
	}
}
