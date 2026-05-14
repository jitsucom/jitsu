package testcontainers

import (
	"context"
	"fmt"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/network"
	"github.com/testcontainers/testcontainers-go"
	tcWait "github.com/testcontainers/testcontainers-go/wait"
)

const redisDefaultPort = "6379/tcp"

// RedisContainer is a Redis testcontainer
type RedisContainer struct {
	Container testcontainers.Container
	Host      string
	Port      int
}

func NewRedisContainer(ctx context.Context) (*RedisContainer, error) {
	hostPort := fmt.Sprintf("%d", utils.GetPort())

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "redis:7-alpine",
			ExposedPorts: []string{redisDefaultPort},
			HostConfigModifier: func(hc *container.HostConfig) {
				hc.PortBindings = network.PortMap{
					network.MustParsePort(redisDefaultPort): []network.PortBinding{{HostPort: hostPort}},
				}
			},
			WaitingFor: tcWait.ForListeningPort(redisDefaultPort).WithStartupTimeout(60 * time.Second),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	port, err := container.MappedPort(ctx, "6379")
	if err != nil {
		_ = container.Terminate(ctx)
		return nil, err
	}
	return &RedisContainer{
		Container: container,
		Host:      host,
		Port:      int(port.Num()),
	}, nil
}

func (rc *RedisContainer) Close() error {
	if rc.Container != nil {
		if err := rc.Container.Terminate(context.Background()); err != nil {
			logging.Errorf("Failed to stop redis container: %v", err)
		}
	}

	return nil
}

// URL returns redis connection string
func (rc *RedisContainer) URL() string {
	return fmt.Sprintf("redis://%s:%d", rc.Host, rc.Port)
}
