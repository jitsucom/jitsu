package setup

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/meta"
)

const projectTemplate = `{
  "$type": "User",
  "_created": "2021-12-02T08:30:47.656Z",
  "_email": "test@jitsu.com",
  "_emailOptout": true,
  "_forcePasswordChange": false,
  "_name": "Test",
  "_onboarded": true,
  "_project": {
    "$type": "Project",
    "_id": "test_project",
    "_name": "Jitsu test",
    "_planId": null
  },
  "_suggestedInfo": {
    "companyName": "Jitsu test",
    "email": "test@jitsu.com",
    "name": "Test"
  },
  "_uid": "%s"
}`

const apiKey = `{
  "keys": [
    {
      "jsAuth": "key1",
      "key": "1",
      "origins": [],
      "serverAuth": "key1",
      "uid": "key1"
    }
  ]
}`

const destinationTemplate = `{
  "destinations": [
    {
      "$type": "PostgresConfig",
      "_formData": {
        "mode": "stream",
		"pghost": "%s",
		"pgport": %d,
        "pguser": "%s",
		"pgpassword": "%s",
        "pgdatabase": "%s",
        "pgschema": "%s",
        "pgsslmode": "disable",
       
        "tableName": "events"
      },
      "_id": "pg1",
      "_mappings": {
        "_keepUnmappedFields": true,
        "_mappings": []
      },
      "_onlyKeys": [
        "key1",
      ],
      "_primary_key_fields": [
        "eventn_ctx_event_id"
      ],
      "_sources": [],
      "_transform": "return $",
      "_transform_enabled": false,
      "_type": "postgres",
      "_uid": "pg1"
    }
  ]
}`

//config#api_keys
//	config#telemetry
//	"config#system"
//	"systems:versions"
//	config#destinations
//	config#users_info

type Service struct {
	authorizationService *authorization.Service
	configurationService *storages.ConfigurationsService
}

func NewService(host string, port int) (*Service, error) {
	redisPoolFactory := meta.NewRedisPoolFactory(host, port, "", false, "")

	redisProvider, err := authorization.NewRedisProvider("access", "refresh", redisPoolFactory)
	if err != nil {
		return nil, err
	}

	redisStorage, err := storages.NewRedis(redisPoolFactory)
	if err != nil {
		return nil, err
	}

	configurationService := storages.NewConfigurationsService(redisStorage, nil)

	authorizationService := authorization.NewConfiguredService(redisProvider, redisStorage)

	return &Service{authorizationService: authorizationService, configurationService: configurationService}, nil
}

func (s *Service) SignUp() (string, error) {
	td, err := s.authorizationService.SignUp("test@jitsu.com", "abc")
	if err != nil {
		return "", fmt.Errorf("signup failed: %v", err)
	}

	return td.AccessToken.UserID, nil
}

//CreateProject creates test user with project
func (s *Service) CreateProject(uid string) error {
	projectPayloadStr := fmt.Sprintf(projectTemplate, uid)
	projectPayload := map[string]interface{}{}
	json.Unmarshal([]byte(projectPayloadStr), &projectPayload)

	if err := s.configurationService.StoreConfig(authorization.UsersInfoCollection, uid, projectPayload); err != nil {
		return fmt.Errorf("project saving failed: %v", err)
	}

	return nil
}

func (s *Service) CreateAPIKey(uid string) error {
	keysPayload := map[string]interface{}{}
	json.Unmarshal([]byte(apiKey), &keysPayload)

	if err := s.configurationService.StoreConfig(storages.ApiKeysCollection, "test_project", keysPayload); err != nil {
		return fmt.Errorf("apikeys saving failed: %v", err)
	}

	return nil
}

func (s *Service) CreateDestination(host string, port int, username, password, database, schema string) error {
	destinationPayloadStr := fmt.Sprintf(destinationTemplate, host, port, username, password, database, schema)
	destinationsPayload := map[string]interface{}{}
	json.Unmarshal([]byte(destinationPayloadStr), &destinationsPayload)

	if err := s.configurationService.StoreConfig(storages.DestinationsCollection, "test_project", destinationsPayload); err != nil {
		return fmt.Errorf("destinations saving failed: %v", err)
	}

	return nil
}
