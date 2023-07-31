package test

import (
	"context"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/testcontainers/testcontainers-go"
	"os"
	"strconv"
)

const envRedisPortVariable = "REDIS_TEST_PORT"

//RedisContainer is a Redis testcontainer
type RedisContainer struct {
	Container testcontainers.Container
	Context   context.Context
	Host      string
	Port      int
}

//NewRedisContainer creates new Redis test container if REDIS_TEST_PORT is not defined. Otherwise uses redis at defined port. This logic is required
// for running test at CI environment
func NewRedisContainer(ctx context.Context) (*RedisContainer, error) {
	envRedisPort := os.Getenv(envRedisPortVariable)
	if envRedisPort != "" {
		port, err := strconv.Atoi(envRedisPort)
		if err != nil {
			return nil, err
		}
		return &RedisContainer{Context: ctx, Host: "localhost", Port: port}, nil
	}

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "redis",
			ExposedPorts: []string{"6379/tcp"},
			//WaitingFor:   tcWait.ForListeningPort("6379").WaitUntilReady(context.Background(), Stra).Timeout(time.Second * 5),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}

	host, err := container.Host(ctx)
	if err != nil {
		return nil, err
	}

	port, err := container.MappedPort(ctx, "6379/tcp")
	if err != nil {
		return nil, err
	}

	return &RedisContainer{Container: container, Context: ctx, Host: host, Port: port.Int()}, nil
}

//Close terminates underlying docker container
func (rc *RedisContainer) Close() {
	if rc.Container != nil {
		err := rc.Container.Terminate(rc.Context)
		if err != nil {
			logging.Error("Failed to stop container")
		}
	}
}
