package coordination

type TableVersionManager interface {
	GetVersion(system string, collection string) (int64, error)
	IncrementVersion(system string, collection string) (int64, error)
}
