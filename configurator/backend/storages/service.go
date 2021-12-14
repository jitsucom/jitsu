package storages

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/random"
	"github.com/jitsucom/jitsu/server/telemetry"
	"time"
)

const (
	defaultDatabaseCredentialsCollection = "default_database_credentials"
	DestinationsCollection               = "destinations"
	sourcesCollection                    = "sources"
	ApiKeysCollection                    = "api_keys"
	customDomainsCollection              = "custom_domains"
	geoDataResolversCollection           = "geo_data_resolvers"
	lastUpdatedField                     = "_lastUpdated"

	telemetryCollection = "telemetry"
	telemetryGlobalID   = "global_configuration"

	LastUpdatedLayout = "2006-01-02T15:04:05.000Z"
)

//collectionsDependencies is used for updating last_updated field in db. It leads Jitsu Server to reload configuration with new changes
var collectionsDependencies = map[string]string{
	geoDataResolversCollection: DestinationsCollection,
}

type ConfigurationsService struct {
	storage            ConfigurationsStorage
	defaultDestination *destinations.Postgres
}

func NewConfigurationsService(storage ConfigurationsStorage, defaultDestination *destinations.Postgres) *ConfigurationsService {
	return &ConfigurationsService{storage: storage, defaultDestination: defaultDestination}
}

//CreateDefaultDestination Creates default destination in case no other destinations exist for the project
func (cs *ConfigurationsService) CreateDefaultDestination(projectID string) (*entities.Database, error) {
	if cs.defaultDestination == nil {
		return nil, errors.New("Default destination postgres isn't configured")
	}

	credentials, err := cs.storage.Get(defaultDatabaseCredentialsCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			//create new
			database, err := cs.defaultDestination.CreateDatabase(projectID)
			if err != nil {
				return nil, fmt.Errorf("Error creating database: [%s]: %v", projectID, err)
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
	return cs.storage.GetCollectionLastUpdated(DestinationsCollection)
}

//GetDestinations return map with projectID:destinations
func (cs ConfigurationsService) GetDestinations() (map[string]*entities.Destinations, error) {
	allDestinations, err := cs.storage.GetAllGroupedByID(DestinationsCollection)
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
	doc, err := cs.storage.Get(DestinationsCollection, projectID)
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
	return cs.storage.GetCollectionLastUpdated(ApiKeysCollection)
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
	data, err := cs.storage.GetAllGroupedByID(ApiKeysCollection)
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
	data, err := cs.storage.Get(ApiKeysCollection, projectID)
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

//GetSourcesLastUpdated returns sources last updated
func (cs *ConfigurationsService) GetSourcesLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(sourcesCollection)
}

//GetSources return map with projectID:sources
func (cs *ConfigurationsService) GetSources() (map[string]*entities.Sources, error) {
	allSources, err := cs.storage.GetAllGroupedByID(sourcesCollection)
	if err != nil {
		return nil, err
	}
	result := map[string]*entities.Sources{}
	err = json.Unmarshal(allSources, &result)
	if err != nil {
		return nil, err
	}
	return result, nil
}

//GetSourcesByProjectID returns sources of input project
func (cs *ConfigurationsService) GetSourcesByProjectID(projectID string) ([]*entities.Source, error) {
	doc, err := cs.storage.Get(sourcesCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.Source, 0), nil
		} else {
			return nil, fmt.Errorf("Error getting sources by projectID [%s]: %v", projectID, err)
		}
	}

	sources := &entities.Sources{}
	err = json.Unmarshal(doc, sources)
	if err != nil {
		return nil, fmt.Errorf("Error parsing sources of projectID [%s]: %v", projectID, err)
	}
	return sources.Sources, nil
}

func (cs *ConfigurationsService) GetGeoDataResolversLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(geoDataResolversCollection)
}

//GetGeoDataResolvers return map with projectID:geo_data_resolver
func (cs *ConfigurationsService) GetGeoDataResolvers() (map[string]*entities.GeoDataResolver, error) {
	allDestinations, err := cs.storage.GetAllGroupedByID(geoDataResolversCollection)
	if err != nil {
		return nil, err
	}
	result := map[string]*entities.GeoDataResolver{}
	err = json.Unmarshal(allDestinations, &result)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func (cs *ConfigurationsService) GetGeoDataResolverByProjectID(projectID string) (*entities.GeoDataResolver, error) {
	doc, err := cs.storage.Get(geoDataResolversCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return nil, nil
		} else {
			return nil, fmt.Errorf("error getting geo data resolvers by projectID [%s]: %v", projectID, err)
		}
	}

	gdr := &entities.GeoDataResolver{}
	err = json.Unmarshal(doc, gdr)
	if err != nil {
		return nil, fmt.Errorf("error parsing geo data resolver of projectID [%s]: %v", projectID, err)
	}
	return gdr, nil
}

//CreateDefaultAPIKey returns generated default key per project only in case if no other API key exists
func (cs *ConfigurationsService) CreateDefaultAPIKey(projectID string) error {
	keys, err := cs.GetAPIKeysByProjectID(projectID)
	if err != nil {
		return err
	}
	if len(keys) > 0 {
		return nil
	}
	_, err = cs.storage.Get(ApiKeysCollection, projectID)
	if err != nil {
		if err != ErrConfigurationNotFound {
			return fmt.Errorf("Error getting api keys by projectID [%s]: %v", projectID, err)
		}
	}
	apiKeyRecord := cs.generateDefaultAPIToken(projectID)
	err = cs.storage.Store(ApiKeysCollection, projectID, apiKeyRecord)
	if err != nil {
		return fmt.Errorf("Failed to store default key for project=[%s]: %v", projectID, err)
	}
	return nil
}

//SaveTelemetry saves telemetry configuration
func (cs *ConfigurationsService) SaveTelemetry(disabledConfiguration map[string]bool) error {
	err := cs.storage.Store(telemetryCollection, telemetryGlobalID, telemetry.Configuration{Disabled: disabledConfiguration})
	if err != nil {
		return fmt.Errorf("Failed to store telemetry settings:: %v", err)
	}
	return nil
}

//GetTelemetry returns telemetry configuration bytes
func (cs *ConfigurationsService) GetTelemetry() ([]byte, error) {
	b, err := cs.storage.Get(telemetryCollection, telemetryGlobalID)
	if err != nil {
		return nil, err
	}

	return b, nil
}

//GetParsedTelemetry returns telemetry configuration
func (cs *ConfigurationsService) GetParsedTelemetry() (*telemetry.Configuration, error) {
	b, err := cs.GetTelemetry()
	if err != nil {
		return nil, err
	}

	telemetryConfig := &telemetry.Configuration{}
	err = json.Unmarshal(b, telemetryConfig)
	if err != nil {
		return nil, fmt.Errorf("Error parsing telemetry configuration: %v", err)
	}
	return telemetryConfig, nil
}

//StoreConfig stores configuration in db and update last update field in dependencies
func (cs *ConfigurationsService) StoreConfig(collection string, key string, entity interface{}) error {
	if err := cs.storage.Store(collection, key, entity); err != nil {
		return err
	}

	if dependency, ok := collectionsDependencies[collection]; ok {
		if err := cs.storage.UpdateCollectionLastUpdated(dependency); err != nil {
			return err
		}
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
	if cs.defaultDestination != nil {
		if err := cs.defaultDestination.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if err := cs.storage.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing configurations storage: %v", err))
	}
	return multiErr
}
