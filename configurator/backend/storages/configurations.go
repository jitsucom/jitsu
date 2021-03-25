package storages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/random"
	"github.com/spf13/viper"
	"time"
)

var ErrConfigurationNotFound = errors.New("Configuration wasn't found")

// Collection here is used as a type of configuration - like destinations, api_keys, custom_domains, etc.
type ConfigurationsStorage interface {
	//Get returns a single configuration from collection
	//If configuration is not found, must return ErrConfigurationNotFound for correct response message
	Get(collection string, id string) ([]byte, error)
	//GetGroupedByID return all the configurations of requested type grouped by id (result must be
	//deserializable to map[string]<entity_type>
	GetAllGroupedByID(collection string) ([]byte, error)
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
		projectID := firebaseViper.GetString("project_id")
		credentialsFile := firebaseViper.GetString("credentials_file")
		return NewFirebase(ctx, projectID, credentialsFile, defaultDestination)
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
func (cs *ConfigurationsService) CreateDefaultDestination(projectID string) (*entities.Database, error) {
	credentials, err := cs.storage.Get(defaultDatabaseCredentialsCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			//create new
			database, err := cs.defaultDestination.CreateDatabase(projectID)
			if err != nil {
				return nil, fmt.Errorf("Error creating postgres default destination for projectID: [%s]: %v", projectID, err)
			}

			err = cs.storage.Store(defaultDatabaseCredentialsCollection, projectID, database)
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
		return nil, fmt.Errorf("Error parsing database entity for [%s] project: %v", projectID, err)
	}
	return database, err
}

func (cs *ConfigurationsService) GetDestinationsLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(destinationsCollection)
}

//GetDestinations return map with projectID:destinations
func (cs ConfigurationsService) GetDestinations() (map[string]*entities.Destinations, error) {
	allDestinations, err := cs.storage.GetAllGroupedByID(destinationsCollection)
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

func (cs *ConfigurationsService) GetDestinationsByProjectID(projectID string) ([]*entities.Destination, error) {
	doc, err := cs.storage.Get(destinationsCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.Destination, 0), nil
		} else {
			return nil, fmt.Errorf("error getting destinations by projectID [%s]: %v", projectID, err)
		}
	}

	dest := &entities.Destinations{}
	err = json.Unmarshal(doc, dest)
	if err != nil {
		return nil, fmt.Errorf("error parsing destinations of projectID [%s]: %v", projectID, err)
	}
	return dest.Destinations, nil
}

func (cs *ConfigurationsService) GetAPIKeysLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(apiKeysCollection)
}

func (cs *ConfigurationsService) GetAPIKeys() ([]*entities.APIKey, error) {
	var result []*entities.APIKey
	keys, err := cs.GetAPIKeysGroupByProjectID()
	if err != nil {
		return nil, err
	}
	for _, apiKeys := range keys {
		result = append(result, apiKeys...)
	}
	return result, nil
}

func (cs *ConfigurationsService) GetAPIKeysGroupByProjectID() (map[string][]*entities.APIKey, error) {
	keys := make(map[string]*entities.APIKeys)
	data, err := cs.storage.GetAllGroupedByID(apiKeysCollection)
	err = json.Unmarshal(data, &keys)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse API keys: %v", err)
	}
	result := make(map[string][]*entities.APIKey)
	for projectID, keys := range keys {
		result[projectID] = keys.Keys
	}
	return result, nil
}

func (cs *ConfigurationsService) GetAPIKeysByProjectID(projectID string) ([]*entities.APIKey, error) {
	data, err := cs.storage.Get(apiKeysCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.APIKey, 0), nil
		}

		return nil, fmt.Errorf("Error getting api keys by projectID [%s]: %v", projectID, err)
	}
	apiKeys := &entities.APIKeys{}
	err = json.Unmarshal(data, apiKeys)
	if err != nil {
		return nil, fmt.Errorf("Error parsing api keys of projectID [%s]: %v", projectID, err)
	}
	return apiKeys.Keys, nil
}

// Generates default key per project only in case if no other API key exists
func (cs *ConfigurationsService) CreateDefaultAPIKey(projectID string) error {
	keys, err := cs.GetAPIKeysByProjectID(projectID)
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		return nil
	}
	_, err = cs.storage.Get(apiKeysCollection, projectID)
	if err != nil {
		if err != ErrConfigurationNotFound {
			return fmt.Errorf("Error getting api keys by projectID [%s]: %v", projectID, err)
		}
	}
	apiKeyRecord := cs.generateDefaultAPIToken(projectID)
	err = cs.storage.Store(apiKeysCollection, projectID, apiKeyRecord)
	if err != nil {
		return fmt.Errorf("Failed to store default key for project=[%s]: %v", projectID, err)
	}
	return nil
}

func (cs *ConfigurationsService) generateDefaultAPIToken(projectID string) entities.APIKeys {
	return entities.APIKeys{
		Keys: []*entities.APIKey{{
			ID:           projectID + "." + random.String(6),
			ClientSecret: "js." + projectID + "." + random.String(21),
			ServerSecret: "s2s." + projectID + "." + random.String(21),
		}},
	}
}

func (cs *ConfigurationsService) GetCustomDomains() (map[string]*entities.CustomDomains, error) {
	customDomains := make(map[string]*entities.CustomDomains)
	data, err := cs.storage.GetAllGroupedByID(customDomainsCollection)
	if err != nil {
		return nil, fmt.Errorf("Failed to get custom domains: %v", err)
	}
	err = json.Unmarshal(data, &customDomains)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse custom domains: %v", err)
	}
	return customDomains, nil
}

func (cs *ConfigurationsService) GetCustomDomainsByProjectID(projectID string) (*entities.CustomDomains, error) {
	data, err := cs.storage.Get(customDomainsCollection, projectID)
	if err != nil {
		return nil, fmt.Errorf("Failed to get custom domains for project [%s]: %v", projectID, err)
	}
	domains := &entities.CustomDomains{}
	err = json.Unmarshal(data, &domains)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse custom domains for project [%s]: [%v]", projectID, err)
	}
	return domains, nil
}

func (cs *ConfigurationsService) UpdateCustomDomain(projectID string, customDomains *entities.CustomDomains) error {
	return cs.storage.Store(customDomainsCollection, projectID, customDomains)
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
