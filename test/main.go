package main

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/test/containers"
	"github.com/jitsucom/jitsu/test/setup"
	"log"
)

//TEST 1. Overriding JITSU_CONFIGURATOR_URL
//RESOURCES: Postgres, Redis, jitsucom/configurator, jitsucom/server
//DESCRIPTION: Run Postgres, Run Redis, put Postgres credentials (as a destination) into the Redis, run Configurator,
//run Server with overridden configurator URL
//send event
func main() {
	ctx := context.Background()
	pgContainer, err := test.NewPostgresContainer(ctx)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pgContainer.Close()

	redisContainer, err := test.NewRedisContainer(ctx)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer redisContainer.Close()

	setupService, err := setup.NewService(redisContainer.Host, redisContainer.Port)
	if err != nil {
		log.Fatalf("setup service: %v", err)
	}

	uid, err := setupService.SignUp()
	if err != nil {
		log.Fatalf("signup: %v", err)
	}

	err = setupService.CreateProject(uid)
	if err != nil {
		log.Fatalf("create project: %v", err)
	}

	err = setupService.CreateAPIKey(uid)
	if err != nil {
		log.Fatalf("create project: %v", err)
	}

	err = setupService.CreateAPIKey(uid)
	if err != nil {
		log.Fatalf("create project: %v", err)
	}

	err = setupService.CreateDestination(pgContainer.Host, pgContainer.Port, pgContainer.Username, pgContainer.Password, pgContainer.Database, pgContainer.Schema)
	if err != nil {
		log.Fatalf("create destination: %v", err)
	}

	c, err := containers.NewConfiguratorContainer(ctx, fmt.Sprintf("redis://%s:%d", redisContainer.Host, redisContainer.Port))
	log.Println(c)

	//TBD
}
