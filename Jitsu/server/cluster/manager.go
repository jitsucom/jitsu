package cluster

const instancePrefix = "en_instance_"

//Manager is a cluster manager for keeping information about active nodes
type Manager interface {
	GetInstances() ([]string, error)
	heartbeat() error
	Close() error
}
