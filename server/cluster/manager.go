package cluster

type Manager interface {
	GetInstances() ([]string, error)
}
