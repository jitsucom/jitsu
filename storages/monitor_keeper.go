package storages

type MonitorKeeper interface {
	Lock(tableName string) error
	Unlock(tableName string) error

	GetVersion(tableName string) (int64, error)
	IncrementVersion(tableName string) (int64, error)
}

type DummyMonitorKeeper struct {
}

func NewMonitorKeeper() MonitorKeeper {
	return &DummyMonitorKeeper{}
}

func (dmk *DummyMonitorKeeper) Lock(tableName string) error {
	return nil
}

func (dmk *DummyMonitorKeeper) Unlock(tableName string) error {
	return nil
}

func (dmk *DummyMonitorKeeper) GetVersion(tableName string) (int64, error) {
	return 1, nil
}

func (dmk *DummyMonitorKeeper) IncrementVersion(tableName string) (int64, error) {
	return 1, nil
}
