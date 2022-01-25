package cluster

type InMemoryManager struct {
	serverNameSingleArray []string
}

func NewInMemoryManager(serverNameSingleArray []string) *InMemoryManager {
	return &InMemoryManager{
		serverNameSingleArray: serverNameSingleArray,
	}
}

func (im *InMemoryManager) GetInstances() ([]string, error) {
	return im.serverNameSingleArray, nil
}

func (im *InMemoryManager) heartbeat() error {
	return nil
}

func (im *InMemoryManager) Close() error {
	return nil
}
