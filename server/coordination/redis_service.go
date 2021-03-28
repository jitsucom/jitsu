package coordination

import (
	"context"
	"fmt"

	"github.com/jitsucom/jitsu/server/storages"
)

type RedisService struct {
	serverName string
	host       string
	port       int
}

func NewRedisService(ctx context.Context, serverName, host string, port int) (Service, error) {
	service := RedisService{
		serverName: serverName,
		host:       host,
		port:       port,
	}

	return &service, nil
}

func (rs *RedisService) Close() error {
	return fmt.Errorf("Close should be implemented")
}

func (rs *RedisService) GetInstances() ([]string, error) {
	return nil, fmt.Errorf("GetInstances should be implemented")
}

func (rs *RedisService) GetVersion(system string, collection string) (int64, error) {
	return 0, fmt.Errorf("GetVersion should be implemented")
}

func (rs *RedisService) IncrementVersion(system string, collection string) (int64, error) {
	return 0, fmt.Errorf("IncrementVersion should be implemented")
}

func (rs *RedisService) IsLocked(system string, collection string) (bool, error) {
	return false, fmt.Errorf("IsLocked should be implemented")
}

func (rs *RedisService) Lock(system string, collection string) (storages.Lock, error) {
	return nil, fmt.Errorf("Lock should be implemented")
}

func (rs *RedisService) TryLock(system string, collection string) (storages.Lock, error) {
	return nil, fmt.Errorf("TryLock should be implemented")
}

func (rs *RedisService) Unlock(lock storages.Lock) error {
	return fmt.Errorf("TryLock should be implemented")
}
