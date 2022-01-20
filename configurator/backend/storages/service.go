package storages

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/random"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"time"
)

const (
	defaultDatabaseCredentialsCollection = "default_database_credentials"
	destinationsCollection               = "destinations"
	sourcesCollection                    = "sources"
	apiKeysCollection                    = "api_keys"
	customDomainsCollection              = "custom_domains"
	geoDataResolversCollection           = "geo_data_resolvers"

	telemetryCollection = "telemetry"
	telemetryGlobalID   = "global_configuration"

	allObjectsIdentifier = "all"

	LastUpdatedLayout = "2006-01-02T15:04:05.000Z"
)

//collectionsDependencies is used for updating last_updated field in db. It leads Jitsu Server to reload configuration with new changes
var collectionsDependencies = map[string]string{
	geoDataResolversCollection: destinationsCollection,
}

type ConfigurationsService struct {
	storage            ConfigurationsStorage
	monitorKeeper      storages.MonitorKeeper
	defaultDestination *destinations.Postgres
}

func NewConfigurationsService(storage ConfigurationsStorage, defaultDestination *destinations.Postgres,
	monitorKeeper storages.MonitorKeeper) *ConfigurationsService {
	return &ConfigurationsService{
		storage:            storage,
		defaultDestination: defaultDestination,
		monitorKeeper:      monitorKeeper,
	}
}

//** Data manipulation **

//saveWithLock locks and uses save func under the hood
func (cs *ConfigurationsService) saveWithLock(objectType, projectID string, object interface{}) ([]byte, error) {
	lock, err := cs.monitorKeeper.Lock(objectType, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	return cs.save(objectType, projectID, object)
}

//getWithLock locks and uses get func under the hood
func (cs *ConfigurationsService) getWithLock(objectType, projectID string) ([]byte, error) {
	lock, err := cs.monitorKeeper.Lock(objectType, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	return cs.get(objectType, projectID)
}

//save proxies save request to the storage and updates dependency collection last_update (if a dependency is present)
func (cs *ConfigurationsService) save(objectType, projectID string, object interface{}) ([]byte, error) {
	serialized, err := json.MarshalIndent(object, "", "    ")
	if err != nil {
		return nil, err
	}

	if err := cs.storage.Store(objectType, projectID, serialized); err != nil {
		return nil, err
	}

	if dependency, ok := collectionsDependencies[objectType]; ok {
		if err := cs.storage.UpdateCollectionLastUpdated(dependency); err != nil {
			return nil, err
		}
	}

	return serialized, nil
}

//get proxies get request to the storage
func (cs *ConfigurationsService) get(objectType, projectID string) ([]byte, error) {
	return cs.storage.Get(objectType, projectID)
}

// ** General functions **

//SaveConfigWithLock proxies call to saveWithLock
func (cs *ConfigurationsService) SaveConfigWithLock(objectType string, id string, entity interface{}) ([]byte, error) {
	return cs.saveWithLock(objectType, id, entity)
}

//GetConfigWithLock proxies call to getWithLock
func (cs *ConfigurationsService) GetConfigWithLock(objectType string, id string) ([]byte, error) {
	return cs.getWithLock(objectType, id)
}

// ** Utility **

//CreateDefaultDestination Creates default destination in case no other destinations exist for the project
func (cs *ConfigurationsService) CreateDefaultDestination(projectID string) (*entities.Database, error) {
	if cs.defaultDestination == nil {
		return nil, errors.New("Default destination postgres isn't configured")
	}

	objectType := defaultDatabaseCredentialsCollection

	lock, err := cs.monitorKeeper.Lock(objectType, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	credentials, err := cs.get(objectType, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			//create new
			database, err := cs.defaultDestination.CreateDatabase(projectID)
			if err != nil {
				return nil, fmt.Errorf("Error creating database: [%s]: %v", projectID, err)
			}

			_, err = cs.save(objectType, projectID, database)
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

//CreateDefaultAPIKey returns generated default key per project only in case if no other API key exists
func (cs *ConfigurationsService) CreateDefaultAPIKey(projectID string) error {
	objectType := apiKeysCollection
	lock, err := cs.monitorKeeper.Lock(objectType, projectID)
	if err != nil {
		return fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	keys, err := cs.GetAPIKeysByProjectID(projectID)
	if err != nil {
		return err
	}

	//don't create default api keys if any exists
	if len(keys) > 0 {
		return nil
	}

	if _, err = cs.get(objectType, projectID); err != nil {
		if err != ErrConfigurationNotFound {
			return fmt.Errorf("error getting api keys [%s] by projectID [%s]: %v", objectType, projectID, err)
		}
	}

	apiKeyRecord := generateDefaultAPIToken(projectID)
	_, err = cs.save(objectType, projectID, apiKeyRecord)
	if err != nil {
		return fmt.Errorf("failed to store default key for project=[%s]: %v", projectID, err)
	}
	return nil
}

// ** Last Updated **

//GetDestinationsLastUpdated returns destinations last updated time
func (cs *ConfigurationsService) GetDestinationsLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(destinationsCollection)
}

//GetAPIKeysLastUpdated returns api keys last updated
func (cs *ConfigurationsService) GetAPIKeysLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(apiKeysCollection)
}

//GetSourcesLastUpdated returns sources last updated
func (cs *ConfigurationsService) GetSourcesLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(sourcesCollection)
}

//GetGeoDataResolversLastUpdated returns geo data resolvers last updated
func (cs *ConfigurationsService) GetGeoDataResolversLastUpdated() (*time.Time, error) {
	return cs.storage.GetCollectionLastUpdated(geoDataResolversCollection)
}

// ** Destinations **

//GetAllDestinations locks and returns all destinations in format map with projectID:destinations
func (cs ConfigurationsService) GetAllDestinations() (map[string]*entities.Destinations, error) {
	objectType := destinationsCollection
	lock, err := cs.monitorKeeper.Lock(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	allDestinations, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, err
	}

	result := map[string]*entities.Destinations{}
	for projectID, destinationsBytes := range allDestinations {
		destEntity := &entities.Destinations{}
		if err := json.Unmarshal(destinationsBytes, destEntity); err != nil {
			logging.Errorf("Failed to parse destination %s, project id=[%s], %v", string(destinationsBytes), projectID, err)
			return nil, err
		}
		result[projectID] = destEntity
	}

	return result, nil
}

//GetDestinationsByProjectID uses getWithLock func under the hood, returns all destinations per project
func (cs *ConfigurationsService) GetDestinationsByProjectID(projectID string) ([]*entities.Destination, error) {
	doc, err := cs.getWithLock(destinationsCollection, projectID)
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

// ** API Keys **

//GetAllAPIKeys locks and returns all api keys
func (cs *ConfigurationsService) GetAllAPIKeys() ([]*entities.APIKey, error) {
	objectType := apiKeysCollection
	lock, err := cs.monitorKeeper.Lock(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	allApiKeys, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, fmt.Errorf("failed to get api keys: %v", err)
	}

	var result []*entities.APIKey
	for projectID, apiKeysBytes := range allApiKeys {
		apiKeysEntity := &entities.APIKeys{}
		if err := json.Unmarshal(apiKeysBytes, apiKeysEntity); err != nil {
			logging.Errorf("failed to parse api keys %s, project id=[%s], %v", string(apiKeysBytes), projectID, err)
			return nil, err
		}
		result = append(result, apiKeysEntity.Keys...)
	}

	return result, nil
}

//GetAPIKeysByProjectID uses getWithLock func under the hood, returns all api keys per project
func (cs *ConfigurationsService) GetAPIKeysByProjectID(projectID string) ([]*entities.APIKey, error) {
	data, err := cs.getWithLock(apiKeysCollection, projectID)
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

// ** Sources **

//GetAllSources locks and returns all sources in format map with projectID:sources
func (cs *ConfigurationsService) GetAllSources() (map[string]*entities.Sources, error) {
	objectType := sourcesCollection
	lock, err := cs.monitorKeeper.Lock(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	allSources, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, fmt.Errorf("failed to get sources: %v", err)
	}

	result := map[string]*entities.Sources{}

	for projectID, sourcesBytes := range allSources {
		sourceEntity := &entities.Sources{}
		if err := json.Unmarshal(sourcesBytes, sourceEntity); err != nil {
			logging.Errorf("Failed to parse source %s, project id=[%s], %v", string(sourcesBytes), projectID, err)
			return nil, err
		}
		result[projectID] = sourceEntity
	}

	return result, nil
}

//GetSourcesByProjectID uses getWithLock func under the hood, returns all sources per project
func (cs *ConfigurationsService) GetSourcesByProjectID(projectID string) ([]*entities.Source, error) {
	doc, err := cs.getWithLock(sourcesCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return make([]*entities.Source, 0), nil
		} else {
			return nil, fmt.Errorf("failed to get sources by projectID [%s]: %v", projectID, err)
		}
	}

	sources := &entities.Sources{}
	if err = json.Unmarshal(doc, sources); err != nil {
		return nil, fmt.Errorf("failed to parse sources of projectID [%s]: %v", projectID, err)
	}
	return sources.Sources, nil
}

// ** Geo Data Resolvers **

//GetGeoDataResolvers locks and returns all sources in format map with projectID:geo_data_resolver
func (cs *ConfigurationsService) GetGeoDataResolvers() (map[string]*entities.GeoDataResolver, error) {
	objectType := geoDataResolversCollection
	lock, err := cs.monitorKeeper.Lock(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	allGeoDataResolvers, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, err
	}

	result := map[string]*entities.GeoDataResolver{}
	for projectID, geoResolverBytes := range allGeoDataResolvers {
		geoResolverEntity := &entities.GeoDataResolver{}
		if err := json.Unmarshal(geoResolverBytes, geoResolverEntity); err != nil {
			logging.Errorf("Failed to parse geo data resolver %s, project id=[%s], %v", string(geoResolverBytes), projectID, err)
			return nil, err
		}
		result[projectID] = geoResolverEntity
	}

	return result, nil
}

//GetGeoDataResolverByProjectID uses getWithLock func under the hood, returns all geo data resolvers per project
func (cs *ConfigurationsService) GetGeoDataResolverByProjectID(projectID string) (*entities.GeoDataResolver, error) {
	doc, err := cs.getWithLock(geoDataResolversCollection, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			return nil, nil
		} else {
			return nil, fmt.Errorf("error getting geo data resolvers by projectID [%s]: %v", projectID, err)
		}
	}

	gdr := &entities.GeoDataResolver{}
	if err = json.Unmarshal(doc, gdr); err != nil {
		return nil, fmt.Errorf("error parsing geo data resolver of projectID [%s]: %v", projectID, err)
	}

	return gdr, nil
}

// ** Telemetry **

//SaveTelemetry uses saveWithLock for saving with lock telemetry settings
func (cs *ConfigurationsService) SaveTelemetry(disabledConfiguration map[string]bool) error {
	_, err := cs.saveWithLock(telemetryCollection, telemetryGlobalID, telemetry.Configuration{Disabled: disabledConfiguration})
	if err != nil {
		return fmt.Errorf("failed to store telemetry settings:: %v", err)
	}
	return nil
}

//GetTelemetry uses getWithLock for getting with lock telemetry settings
func (cs *ConfigurationsService) GetTelemetry() ([]byte, error) {
	b, err := cs.getWithLock(telemetryCollection, telemetryGlobalID)
	if err != nil {
		return nil, fmt.Errorf("failed to get telemetry settings:: %v", err)
	}

	return b, nil
}

//GetParsedTelemetry returns telemetry configuration using GetTelemetry func
func (cs *ConfigurationsService) GetParsedTelemetry() (*telemetry.Configuration, error) {
	b, err := cs.GetTelemetry()
	if err != nil {
		return nil, err
	}

	telemetryConfig := &telemetry.Configuration{}
	if err = json.Unmarshal(b, telemetryConfig); err != nil {
		return nil, fmt.Errorf("failed to  parse telemetry configuration: %v", err)
	}
	return telemetryConfig, nil
}

// ** Domains **

//GetAllCustomDomains locks and returns all domains in format map with projectID:domains
func (cs *ConfigurationsService) GetAllCustomDomains() (map[string]*entities.CustomDomains, error) {
	objectType := customDomainsCollection
	lock, err := cs.monitorKeeper.Lock(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	result := make(map[string]*entities.CustomDomains)
	customDomains, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, fmt.Errorf("failed to get custom domains: %v", err)
	}

	for projectID, customDomainsBytes := range customDomains {
		customDomainEntity := &entities.CustomDomains{}
		if err := json.Unmarshal(customDomainsBytes, customDomainEntity); err != nil {
			logging.Errorf("Failed to parse custom domain %s, project id=[%s], %v", string(customDomainsBytes), projectID, err)
			return nil, err
		}
		result[projectID] = customDomainEntity
	}
	return result, nil
}

//GetCustomDomainsByProjectID uses getWithLock func under the hood, returns all domains per project
func (cs *ConfigurationsService) GetCustomDomainsByProjectID(projectID string) (*entities.CustomDomains, error) {
	data, err := cs.getWithLock(customDomainsCollection, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to get custom domains for project [%s]: %v", projectID, err)
	}
	domains := &entities.CustomDomains{}
	if err = json.Unmarshal(data, &domains); err != nil {
		return nil, fmt.Errorf("failed to parse custom domains for project [%s]: [%v]", projectID, err)
	}
	return domains, nil
}

//UpdateCustomDomain proxies call to saveWithLock
func (cs *ConfigurationsService) UpdateCustomDomain(projectID string, customDomains *entities.CustomDomains) error {
	_, err := cs.saveWithLock(customDomainsCollection, projectID, customDomains)
	return err
}

// ** Objects API **

//PatchConfigWithLock locks by collection and projectID, applies pathPayload to data, saves and returns the updated object
func (cs *ConfigurationsService) PatchConfigWithLock(collection, projectID string, patchPayload *PatchPayload) ([]byte, error) {
	lock, err := cs.monitorKeeper.Lock(collection, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	data, err := cs.get(collection, projectID)
	if err != nil {
		return nil, err
	}

	collectionData := map[string]interface{}{}
	if err := json.Unmarshal(data, &collectionData); err != nil {
		return nil, fmt.Errorf("error unmarshal data: %v", err)
	}

	objectsArrayI, ok := collectionData[patchPayload.ObjectArrayPath]
	if !ok {
		return nil, fmt.Errorf("path [%s] doesn't exist in the collection", patchPayload.ObjectArrayPath)
	}

	objectsArray, ok := objectsArrayI.([]interface{})
	if !ok {
		return nil, fmt.Errorf("path [%s] is not an array (is %T) in the collection", patchPayload.ObjectArrayPath, objectsArrayI)
	}

	for i, objectI := range objectsArray {
		foundObject, ok, err := findObject(i, objectI, patchPayload.ObjectArrayPath, collection, projectID, patchPayload.ObjectMeta)
		if err != nil {
			return nil, err
		}

		if ok {
			newObject := jsonutils.Merge(foundObject, patchPayload.Patch)
			objectsArray[i] = newObject
			collectionData[patchPayload.ObjectArrayPath] = objectsArray

			_, err := cs.save(collection, projectID, collectionData)
			if err != nil {
				return nil, err
			}

			newObjectBytes, err := json.Marshal(newObject)
			if err != nil {
				return nil, fmt.Errorf("error serializing patched object: %v", err)
			}

			return newObjectBytes, nil
		}
	}

	return nil, fmt.Errorf("object hasn't been found by id in path [%s] in the collection", patchPayload.ObjectArrayPath)
}

//DeleteObjectWithLock locks by collection and projectID, deletes object by objectUID, saves and returns deleted object
func (cs *ConfigurationsService) DeleteObjectWithLock(collection, projectID, objectArrayPath string, objectMeta *ObjectMeta) ([]byte, error) {
	lock, err := cs.monitorKeeper.Lock(collection, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	data, err := cs.get(collection, projectID)
	if err != nil {
		return nil, err
	}

	collectionData := map[string]interface{}{}
	if err := json.Unmarshal(data, &collectionData); err != nil {
		return nil, fmt.Errorf("error unmarshal data: %v", err)
	}

	objectsArrayI, ok := collectionData[objectArrayPath]
	if !ok {
		return nil, fmt.Errorf("path [%s] doesn't exist in the collection", objectArrayPath)
	}

	objectsArray, ok := objectsArrayI.([]interface{})
	if !ok {
		return nil, fmt.Errorf("path [%s] is not an array (is %T) in the collection", objectArrayPath, objectsArrayI)
	}

	for i, objectI := range objectsArray {
		foundObject, ok, err := findObject(i, objectI, objectArrayPath, collection, projectID, objectMeta)
		if err != nil {
			return nil, err
		}

		if ok {
			//save without foundObject
			newObjectsArray := append(objectsArray[:i], objectsArray[i+1:]...)
			collectionData[objectArrayPath] = newObjectsArray

			_, err := cs.save(collection, projectID, collectionData)
			if err != nil {
				return nil, err
			}

			deletedObjectBytes, err := json.Marshal(foundObject)
			if err != nil {
				return nil, fmt.Errorf("error serializing deleted object: %v", err)
			}

			return deletedObjectBytes, nil
		}
	}

	return nil, fmt.Errorf("object hasn't been found by id in path [%s] in the collection", objectArrayPath)
}

//GetObjectWithLock locks by collection and projectID, gets object by objectUID and returns it
func (cs *ConfigurationsService) GetObjectWithLock(collection, projectID, objectArrayPath string, objectMeta *ObjectMeta) ([]byte, error) {
	lock, err := cs.monitorKeeper.Lock(collection, projectID)
	if err != nil {
		return nil, fmt.Errorf("error locking: %v", err)
	}
	defer cs.monitorKeeper.Unlock(lock)

	data, err := cs.get(collection, projectID)
	if err != nil {
		return nil, err
	}

	collectionData := map[string]interface{}{}
	if err := json.Unmarshal(data, &collectionData); err != nil {
		return nil, fmt.Errorf("error unmarshal data: %v", err)
	}

	objectsArrayI, ok := collectionData[objectArrayPath]
	if !ok {
		return nil, fmt.Errorf("path [%s] doesn't exist in the collection", objectArrayPath)
	}

	objectsArray, ok := objectsArrayI.([]interface{})
	if !ok {
		return nil, fmt.Errorf("path [%s] is not an array (is %T) in the collection", objectArrayPath, objectsArrayI)
	}

	for i, objectI := range objectsArray {
		foundObject, ok, err := findObject(i, objectI, objectArrayPath, collection, projectID, objectMeta)
		if err != nil {
			return nil, err
		}

		if ok {
			foundObjectBytes, err := json.Marshal(foundObject)
			if err != nil {
				return nil, fmt.Errorf("error serializing object: %v", err)
			}

			return foundObjectBytes, nil
		}
	}

	return nil, fmt.Errorf("object hasn't been found by id in path [%s] in the collection", objectArrayPath)
}

func (cs *ConfigurationsService) Close() (multiErr error) {
	if cs.defaultDestination != nil {
		if err := cs.defaultDestination.Close(); err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}

	if err := cs.monitorKeeper.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	if err := cs.storage.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing configurations storage: %v", err))
	}
	return multiErr
}

//findObject returns object and true if input objectI has the same ID as in objectMeta
func findObject(i int, objectI interface{}, objectArrayPath, collection, projectID string, objectMeta *ObjectMeta) (map[string]interface{}, bool, error) {
	object, ok := objectI.(map[string]interface{})
	if !ok {
		logging.Infof("element [%T: %v] isn't an object in path [%s] in the %s collection by %s ID", objectI, objectI, objectArrayPath, collection, projectID)
		return nil, false, fmt.Errorf("element with index: %d isn't an object in path [%s] in the collection", i, objectArrayPath)
	}

	idValue, ok := object[objectMeta.IDFieldPath]
	if !ok {
		logging.Infof("element [%v] doesn't have an id field in path [%s] in the %s collection by %s ID", object, objectMeta.IDFieldPath, collection, projectID)
		return nil, false, fmt.Errorf("element with index: %d doesn't have an id field in path [%s] in the collection", i, objectMeta.IDFieldPath)
	}

	if fmt.Sprint(idValue) == fmt.Sprint(objectMeta.Value) {
		return object, true, nil
	}

	return nil, false, nil
}

func generateDefaultAPIToken(projectID string) entities.APIKeys {
	return entities.APIKeys{
		Keys: []*entities.APIKey{{
			ID:           projectID + "." + random.String(6),
			ClientSecret: "js." + projectID + "." + random.String(21),
			ServerSecret: "s2s." + projectID + "." + random.String(21),
		}},
	}
}
