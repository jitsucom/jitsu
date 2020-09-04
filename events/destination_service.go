package events

import "sync"

//DestinationService is reloadable service of events destinations per token
type DestinationService struct {
	sync.RWMutex
	consumersByToken map[string][]Consumer
	storagesByToken  map[string][]Storage
}

func NewDestinationService(consumersByToken map[string][]Consumer, storagesByToken map[string][]Storage) *DestinationService {
	return &DestinationService{
		RWMutex:          sync.RWMutex{},
		consumersByToken: consumersByToken,
		storagesByToken:  storagesByToken,
	}
}

func (ds *DestinationService) GetConsumers(token string) []Consumer {
	ds.RLock()
	defer ds.RUnlock()
	return ds.consumersByToken[token]
}

func (ds *DestinationService) GetStorages(token string) []Storage {
	ds.RLock()
	defer ds.RUnlock()
	return ds.storagesByToken[token]
}

func (ds *DestinationService) Reload(consumersByToken map[string][]Consumer, storagesByToken map[string][]Storage) {
	ds.Lock()
	defer ds.Unlock()
	ds.storagesByToken = storagesByToken
	ds.consumersByToken = consumersByToken
}
