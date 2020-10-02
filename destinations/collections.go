package destinations

import "github.com/ksensehq/eventnative/events"

//map["token"]map["destination_name"]interface
//because 1 token = ∞ storages
type TokenizedStorages map[string]map[string]events.StorageProxy

//map["token"]map["token | destination_name"]interface
//because 1 token = 1logger but ∞ event.queue
type TokenizedConsumers map[string]map[string]events.Consumer

func (ts TokenizedStorages) Add(token, name string, proxy events.StorageProxy) {
	storageProxies, ok := ts[token]
	if !ok {
		storageProxies = map[string]events.StorageProxy{}
		ts[token] = storageProxies
	}
	storageProxies[name] = proxy
}

func (ts TokenizedStorages) AddAll(other TokenizedStorages) {
	for token, storages := range other {
		for name, storage := range storages {
			ts.Add(token, name, storage)
		}
	}
}

func (tc TokenizedConsumers) Add(token, name string, proxy events.Consumer) {
	consumers, ok := tc[token]
	if !ok {
		consumers = map[string]events.Consumer{}
		tc[token] = consumers
	}
	consumers[name] = proxy
}

func (tc TokenizedConsumers) AddAll(other TokenizedConsumers) {
	for token, consumers := range other {
		for name, consumer := range consumers {
			tc.Add(token, name, consumer)
		}
	}
}
