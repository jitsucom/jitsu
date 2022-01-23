package redis

type LockExtender interface {
	Extend() (bool, error)
}
