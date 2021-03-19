package storages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/configurator/destinations"
	"github.com/jitsucom/eventnative/configurator/entities"
	"github.com/jitsucom/eventnative/configurator/random"
	"github.com/spf13/viper"
	"time"
)

var ErrConfigurationNotFound = errors.New("Configuration wasn't found")

// Collection here is used as a type of configuration - like destinations, api_keys, custom_domains, etc.
type ConfigurationsStorage interface {
	//Get returns a single configuration from collection
	//If configuration is not found, must return ErrConfigurationNotFound for correct response message
	Get(collection string, id string) ([]byte, error)
	//GetGroupedById return all the configurations of requested type grouped by id (result must be
	//deserializable to map[string]<entity_type>
	GetAllGroupedById(collection string) ([]byte, error)
	//GetCollectionLastUpdated returns time when collection was last updated
	//(max _lastUpdated field among entities)
	GetCollectionLastUpdated(collection string) (*time.Time, error)
	//Store saves entity and also must update _lastUpdated field of the collection
	Store(collection string, id string, entity interface{}) error
	//Close frees all the resources used by the storage (close connections etc.)
	Close() error
}

func NewConfigurationsStorage(ctx context.Context, storageViper *viper.Viper, defaultDestination *destinations.Postgres) (ConfigurationsStorage, error) {
	if storageViper.IsSet("firebase") {
		firebaseViper := storageViper.Sub("firebase")
		projectId := firebaseViper.GetString("project_id")
		credentialsFile := firebaseViper.GetString("credentials_file")
		return NewFirebase(ctx, projectId, credentialsFile, defaultDestination)
	} else if storageViper.IsSet("redis") {
		redisViper := storageViper.Sub("redis")
		host := redisViper.GetString("host")
		if host == "" {
			return nil, errors.New("storage.redis.host must not be empty")
		}
		port := redisViper.GetInt("port")
		if port == 0 {
			return nil, errors.New("storage.redis.port must be configured")
		}
		password := redisViper.GetString("password")
		return NewRedis(host, port, password)
	} else {
		return nil, errors.New("Unknown storage type. Supported: firebase, redis")
	}
}

type ConfigurationsService struct {
	storage            ConfigurationsStorage
	defaultDestination *destinations.Postgres
}

func NewConfigurationsService(storage ConfigurationsStorage, defaultDestination *destinations.Postgres) *ConfigurationsService {
	return &ConfigurationsService{storage: storage, defaultDestination: defaultDestination}
}

const (
	defaultDatabaseCredentialsCollection = "default_database_credentials"
	destinationsCollection               = "destinations"
	apiKeysCollection                    = "api_keys"
	customDomainsCollection              = "custom_domains"
	lastUpdatedField                     = "_lastUpdated"

	LastUpdatedLayout = "2006-01-02T15:04:05.000Z"
)

//CreateDefaultDestination Creates default destination in case no other destinations exist for the project
func (cs *ConfigurationsService) CreateDefaultDestination(projectId string) (*entities.Database, error) {
	credentials, err := cs.storage.Get(defaultDatabaseCredentialsCollection, projectId)
	if err != nil {
		if err == ErrConfigurationNotFound {
			//create new
			database, err := cs.defaultDestination.CreateDatabase(projectId)
			if err != nil {
				return nil, fmt.Errorf("Error creating postgres default destination for projectId: [%s]: %v", projectId, err)
			}

			err = cs.storage.Store(defaultDatabaseCredentialsCollection, projectId, database)
			if err != nil {
				return nil, err
			}
			return database, nil
		} else {
			return nil, err
		}
	}
	//parse
	database := &entities.Database{}
	err = json.Unmarshal(credentials, database)
	if err != nil {
		return nil, fmt.Errorf("Error parsing database entity for [%s] project: %v", projectId, err)
	}
	return database, err
}

func (cs *ConfigurationsService) GetDestinationsLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(destinationsCollection)
}

//GetDestinations return map with projectId:destinations
func (cs ConfigurationsService) GetDestinations() (map[string]*entities.Destinations, error) {
	allDestinations, err := cs.storage.GetAllGroupedById(destinationsCollection)
	if err != nil {
		return nil, err
	}
	result := map[string]*entities.Destinations{}
	err = json.Unmarshal(allDestinations, &result)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (cs *ConfigurationsService) GetDestinationsByProjectId(projectId string) ([]*entities.Destination, error) {
	doc, err := cs.storage.Get(destinationsCollection, projectId)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.Destination, 0), nil
		} else {
			return nil, fmt.Errorf("error getting destinations by projectId [%s]: %v", projectId, err)
		}
	}

	dest := &entities.Destinations{}
	err = json.Unmarshal(doc, dest)
	if err != nil {
		return nil, fmt.Errorf("error parsing destinations of projectId [%s]: %v", projectId, err)
	}
	return dest.Destinations, nil
}

func (cs *ConfigurationsService) GetApiKeysLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(apiKeysCollection)
}

func (cs *ConfigurationsService) GetApiKeys() ([]*entities.ApiKey, error) {
	var result []*entities.ApiKey
	keys, err := cs.GetApiKeysGroupByProjectId()
	if err != nil {
		return nil, err
	}
	for _, apiKeys := range keys {
		result = append(result, apiKeys...)
	}
	return result, nil
}

func (cs *ConfigurationsService) GetApiKeysGroupByProjectId() (map[string][]*entities.ApiKey, error) {
	keys := make(map[string]*entities.ApiKeys)
	data, err := cs.storage.GetAllGroupedById(apiKeysCollection)
	err = json.Unmarshal(data, &keys)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse API keys: %v", err)
	}
	result := make(map[string][]*entities.ApiKey)
	for projectId, keys := range keys {
		result[projectId] = keys.Keys
	}
	return result, nil
}

func (cs *ConfigurationsService) GetApiKeysByProjectId(projectId string) ([]*entities.ApiKey, error) {
	data, err := cs.storage.Get(apiKeysCollection, projectId)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.ApiKey, 0), nil
		} else {
			return nil, fmt.Errorf("Error getting api keys by projectId [%s]: %v", projectId, err)
		}
	}
	apiKeys := &entities.ApiKeys{}
	err = json.Unmarshal(data, apiKeys)
	if err != nil {
		return nil, fmt.Errorf("Error parsing api keys of projectId [%s]: %v", projectId, err)
	}
	return apiKeys.Keys, nil
}

// Generates default key per project only in case if no other API key exists
func (cs *ConfigurationsService) CreateDefaultApiKey(projectId string) error {
	keys, err := cs.GetApiKeysByProjectId(projectId)
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		return nil
	}
	_, err = cs.storage.Get(apiKeysCollection, projectId)
	if err != nil {
		if err != ErrConfigurationNotFound {
			return fmt.Errorf("Error getting api keys by projectId [%s]: %v", projectId, err)
		}
	}
	apiKeyRecord := cs.generateDefaultAPIToken(projectId)
	err = cs.storage.Store(apiKeysCollection, projectId, apiKeyRecord)
	if err != nil {
		return fmt.Errorf("Failed to store default key for project=[%s]: %v", projectId, err)
	}
	return nil
}

func (cs *ConfigurationsService) generateDefaultAPIToken(projectId string) entities.ApiKeys {
	return entities.ApiKeys{
		Keys: []*entities.ApiKey{{
			Id:           projectId + "." + random.String(6),
			ClientSecret: "js." + projectId + "." + random.String(21),
			ServerSecret: "s2s." + projectId + "." + random.String(21),
		}},
	}
}

func (cs *ConfigurationsService) GetCustomDomains() (map[string]*entities.CustomDomains, error) {
	customDomains := make(map[string]*entities.CustomDomains)
	data, err := cs.storage.GetAllGroupedById(customDomainsCollection)
	if err != nil {
		return nil, fmt.Errorf("Failed to get custom domains: %v", err)
	}
	err = json.Unmarshal(data, &customDomains)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse custom domains: %v", err)
	}
	return customDomains, nil
}

func (cs *ConfigurationsService) GetCustomDomainsByProjectId(projectId string) (*entities.CustomDomains, error) {
	data, err := cs.storage.Get(customDomainsCollection, projectId)
	if err != nil {
		return nil, fmt.Errorf("Failed to get custom domains for project [%s]: %v", projectId, err)
	}
	domains := &entities.CustomDomains{}
	err = json.Unmarshal(data, &domains)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse custom domains for project [%s]: [%v]", projectId, err)
	}
	return domains, nil
}

func (cs *ConfigurationsService) UpdateCustomDomain(projectId string, customDomains *entities.CustomDomains) error {
	return cs.storage.Store(customDomainsCollection, projectId, customDomains)
}

func (cs *ConfigurationsService) Close() (multiErr error) {
	if err := cs.defaultDestination.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	if err := cs.storage.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing configurations storage: %v", err))
	}
	return multiErr
}
