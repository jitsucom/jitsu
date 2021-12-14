package containers

import (
	"context"
	"github.com/testcontainers/testcontainers-go"
)

type JitsuConfigurator struct {
	container testcontainers.Container
}

//NewConfiguratorContainer creates new jitsucom/configurator test container
func NewConfiguratorContainer(ctx context.Context, redisURL string) (*JitsuConfigurator, error) {

	envVars := make(map[string]string, 0)
	envVars["REDIS_URL"] = redisURL

	container, err := testcontainers.GenericContainer(ctx, testcontainers.GenericContainerRequest{
		ContainerRequest: testcontainers.ContainerRequest{
			Image:        "jitsucom/configurator:beta",
			ExposedPorts: []string{"7000"},
			Env:          envVars,
			//WaitingFor:   tcWait.ForSQL(pgDefaultPort, "postgres", dbURL).Timeout(time.Second * 60),
		},
		Started: true,
	})
	if err != nil {
		return nil, err
	}
	/*host, err := container.Host(ctx)
	if err != nil {
		return nil, err
	}
	port, err := container.MappedPort(ctx, "7000")*/
	if err != nil {
		return nil, err
	}
	return &JitsuConfigurator{container: container}, nil
}
