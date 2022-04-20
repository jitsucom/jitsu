package storages

import (
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"strings"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/random"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/pkg/errors"
)

const (
	defaultDatabaseCredentialsCollection = "default_database_credentials"
	destinationsCollection               = "destinations"
	sourcesCollection                    = "sources"
	apiKeysCollection                    = "api_keys"
	customDomainsCollection              = "custom_domains"
	geoDataResolversCollection           = "geo_data_resolvers"
	projectSettingsCollection            = "project_settings"
	userProjectRelation                  = "user_project"

	telemetryCollection = "telemetry"
	TelemetryGlobalID   = "global_configuration"

	airbyteType      = "airbyte"
	singerType       = "singer"
	airbyteTypeField = "docker_image"
	singerTypeField  = "tap"
	configField      = "config"

	allObjectsIdentifier = "all"

	LastUpdatedLayout = "2006-01-02T15:04:05.000Z"

	defaultProjectObjectLockTimeout = time.Second * 40

	unknownObjectPosition = -1
)

//collectionsDependencies is used for updating last_updated field in db. It leads Jitsu Server to reload configuration with new changes
var collectionsDependencies = map[string]string{
	geoDataResolversCollection: destinationsCollection,
}

type ConfigurationsService struct {
	storage            ConfigurationsStorage
	lockFactory        locks.LockFactory
	defaultDestination *destinations.Postgres
	locksCloser        io.Closer
}

func NewConfigurationsService(storage ConfigurationsStorage, defaultDestination *destinations.Postgres,
	lockFactory locks.LockFactory) *ConfigurationsService {
	return &ConfigurationsService{
		storage:            storage,
		defaultDestination: defaultDestination,
		lockFactory:        lockFactory,
	}
}

//** Data manipulation **

//saveWithLock locks and uses save func under the hood
func (cs *ConfigurationsService) saveWithLock(objectType, projectID string, projectConfig interface{}) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	return cs.save(objectType, projectID, projectConfig)
}

//getWithLock locks and uses get func under the hood
func (cs *ConfigurationsService) getWithLock(objectType, projectID string) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	return cs.get(objectType, projectID)
}

//save proxies save request to the storage and updates dependency collection last_update (if a dependency is present)
func (cs *ConfigurationsService) save(objectType, projectID string, projectConfig interface{}) ([]byte, error) {
	serialized, err := json.MarshalIndent(projectConfig, "", "    ")
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

//save proxies delete request to the storage and updates dependency collection last_update (if a dependency is present)
func (cs *ConfigurationsService) delete(objectType, projectID string) error {
	if err := cs.storage.Delete(objectType, projectID); err != nil {
		return err
	}

	if dependency, ok := collectionsDependencies[objectType]; ok {
		if err := cs.storage.UpdateCollectionLastUpdated(dependency); err != nil {
			return err
		}
	}

	return nil
}

//get proxies get request to the storage
func (cs *ConfigurationsService) get(objectType, projectID string) ([]byte, error) {
	return cs.storage.Get(objectType, projectID)
}

// ** General functions **

//SaveConfigWithLock proxies call to saveWithLock
func (cs *ConfigurationsService) SaveConfigWithLock(objectType string, projectID string, projectConfig interface{}) ([]byte, error) {
	return cs.saveWithLock(objectType, projectID, projectConfig)
}

//GetConfigWithLock proxies call to getWithLock
func (cs *ConfigurationsService) GetConfigWithLock(objectType string, projectID string) (json.RawMessage, error) {
	return cs.getWithLock(objectType, projectID)
}

// ** Utility **

//CreateDefaultDestination Creates default destination in case no other destinations exist for the project
func (cs *ConfigurationsService) CreateDefaultDestination(projectID string) (*entities.Database, error) {
	if cs.defaultDestination == nil {
		return nil, errors.New("Default destination postgres isn't configured")
	}

	objectType := defaultDatabaseCredentialsCollection

	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return err
	}
	defer lock.Unlock()

	keys, err := cs.getAPIKeysByProjectID(projectID)
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
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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

//GetAllAPIKeysPerProjectByID locks and returns all api keys grouped by project
func (cs *ConfigurationsService) GetAllAPIKeysPerProjectByID() (map[string]map[string]entities.APIKey, error) {
	objectType := apiKeysCollection
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	allApiKeys, err := cs.storage.GetAllGroupedByID(objectType)
	if err != nil {
		return nil, fmt.Errorf("failed to get api keys: %v", err)
	}

	result := map[string]map[string]entities.APIKey{}
	for projectID, apiKeysBytes := range allApiKeys {
		apiKeysEntity := &entities.APIKeys{}
		if err := json.Unmarshal(apiKeysBytes, apiKeysEntity); err != nil {
			logging.Errorf("failed to parse api keys %s, project id=[%s], %v", string(apiKeysBytes), projectID, err)
			return nil, err
		}

		apikeys := map[string]entities.APIKey{}
		for _, key := range apiKeysEntity.Keys {
			apikeys[key.ID] = *key
		}
		result[projectID] = apikeys
	}

	return result, nil
}

//GetAPIKeysByProjectID uses getWithLock func under the hood, returns all api keys per project
func (cs *ConfigurationsService) GetAPIKeysByProjectID(projectID string) ([]*entities.APIKey, error) {
	lock, err := cs.lockProjectObject(apiKeysCollection, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()
	apiKeys, err := cs.getAPIKeysByProjectID(projectID)
	if err != nil {
		return nil, err
	}
	return apiKeys, nil
}

//getAPIKeysByProjectID uses get func under the hood, returns all api keys per project
func (cs *ConfigurationsService) getAPIKeysByProjectID(projectID string) ([]*entities.APIKey, error) {
	data, err := cs.get(apiKeysCollection, projectID)
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
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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
	_, err := cs.saveWithLock(telemetryCollection, TelemetryGlobalID, telemetry.Configuration{Disabled: disabledConfiguration})
	if err != nil {
		return fmt.Errorf("failed to store telemetry settings:: %v", err)
	}
	return nil
}

//GetTelemetry uses getWithLock for getting with lock telemetry settings
func (cs *ConfigurationsService) GetTelemetry() ([]byte, error) {
	b, err := cs.getWithLock(telemetryCollection, TelemetryGlobalID)
	if err != nil {
		return nil, err
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
	lock, err := cs.lockProjectObject(objectType, allObjectsIdentifier)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

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

//CreateObjectWithLock locks project object Types and add new object
//returns new object
func (cs *ConfigurationsService) CreateObjectWithLock(objectType string, projectID string, object *openapi.AnyObject) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	arrayPath := cs.GetObjectArrayPathByObjectType(objectType)

	//extract configuration fields
	idField := cs.GetObjectIDField(objectType)
	typeField := cs.GetObjectTypeField(objectType)

	projectConfigBytes, err := cs.get(objectType, projectID)
	if err != nil {
		if err == ErrConfigurationNotFound {
			generatedID := cs.GenerateID(typeField, objectType, projectID, object, map[string]bool{})
			object.Set(idField, generatedID)

			//first object of objectType in project
			newProjectConfig := buildProjectDataObject(nil, nil, object.AdditionalProperties, unknownObjectPosition, arrayPath)

			if _, err := cs.save(objectType, projectID, newProjectConfig); err != nil {
				return nil, err
			}

			return object.MarshalJSON()
		}

		return nil, err
	}

	projectConfig, objectsArray, err := deserializeProjectObjects(projectConfigBytes, arrayPath, objectType, projectID)
	if err != nil {
		return nil, err
	}

	//extract all used ids
	usedIDs := make(map[string]bool, len(objectsArray))
	for _, obj := range objectsArray {
		objID, ok := obj[idField]
		if ok {
			usedIDs[fmt.Sprint(objID)] = true
		}
	}

	generatedID := cs.GenerateID(typeField, objectType, projectID, object, usedIDs)
	object.Set(idField, generatedID)

	newProjectConfig := buildProjectDataObject(projectConfig, objectsArray, object.AdditionalProperties, unknownObjectPosition, arrayPath)

	if _, err := cs.save(objectType, projectID, newProjectConfig); err != nil {
		return nil, err
	}

	return object.MarshalJSON()
}

//PatchObjectWithLock locks by collection and projectID, applies pathPayload to data, saves and returns the updated object
func (cs *ConfigurationsService) PatchObjectWithLock(objectType, projectID string, patchPayload *PatchPayload) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	data, err := cs.get(objectType, projectID)
	if err != nil {
		return nil, err
	}

	projectConfig, objectsArray, err := deserializeProjectObjects(data, patchPayload.ObjectArrayPath, objectType, projectID)
	if err != nil {
		return nil, err
	}

	ensureIDNotChanged(patchPayload)

	//build projectConfig with patched object
	var newProjectConfigWithObject map[string]interface{}
	var patchedObject map[string]interface{}
	if patchPayload.ObjectArrayPath == "" && objectsArray == nil {
		//single object (geo data resolver or telemetry)
		newProjectConfigWithObject = jsonutils.Merge(projectConfig, patchPayload.Patch)
	} else {
		objectPosition := unknownObjectPosition
		for i, objectI := range objectsArray {
			_, ok, err := findObject(i, objectI, objectType, projectID, patchPayload.ObjectMeta)
			if err != nil {
				return nil, err
			}
			if ok {
				objectPosition = i
				break
			}
		}
		if objectPosition == unknownObjectPosition {
			return nil, fmt.Errorf("object hasn't been found by id in path [%s] in the collection", patchPayload.ObjectArrayPath)
		}

		patchedObject = jsonutils.Merge(objectsArray[objectPosition], patchPayload.Patch)

		newProjectConfigWithObject = buildProjectDataObject(projectConfig, objectsArray, patchedObject, objectPosition, patchPayload.ObjectArrayPath)
	}

	if _, err := cs.save(objectType, projectID, newProjectConfigWithObject); err != nil {
		return nil, err
	}

	newObjectBytes, err := json.Marshal(patchedObject)
	if err != nil {
		return nil, fmt.Errorf("error serializing patched object: %v", err)
	}

	return newObjectBytes, nil
}

//ReplaceObjectWithLock locks by collection and projectID, rewrite pathPayload, saves and returns the updated object
func (cs *ConfigurationsService) ReplaceObjectWithLock(objectType, projectID string, patchPayload *PatchPayload) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	data, err := cs.get(objectType, projectID)
	if err != nil {
		return nil, err
	}

	projectConfig, objectsArray, err := deserializeProjectObjects(data, patchPayload.ObjectArrayPath, objectType, projectID)
	if err != nil {
		return nil, err
	}

	ensureIDNotChanged(patchPayload)

	//build projectConfig with patched object
	var newProjectConfigWithObject map[string]interface{}
	if patchPayload.ObjectArrayPath == "" && objectsArray == nil {
		//single object (geo data resolver or telemetry)
		newProjectConfigWithObject = patchPayload.Patch
	} else {
		objectPosition := unknownObjectPosition
		for i, objectI := range objectsArray {
			_, ok, err := findObject(i, objectI, objectType, projectID, patchPayload.ObjectMeta)
			if err != nil {
				return nil, err
			}
			if ok {
				objectPosition = i
				break
			}
		}

		newProjectConfigWithObject = buildProjectDataObject(projectConfig, objectsArray, patchPayload.Patch, objectPosition, patchPayload.ObjectArrayPath)
	}

	if _, err := cs.save(objectType, projectID, newProjectConfigWithObject); err != nil {
		return nil, err
	}

	newObjectBytes, err := json.Marshal(patchPayload.Patch)
	if err != nil {
		return nil, fmt.Errorf("error serializing new object: %v", err)
	}

	return newObjectBytes, nil
}

//DeleteObjectWithLock locks by collection and projectID, deletes object by objectUID, saves and returns deleted object
func (cs *ConfigurationsService) DeleteObjectWithLock(objectType, projectID string, deletePayload *PatchPayload) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	data, err := cs.get(objectType, projectID)
	if err != nil {
		return nil, err
	}

	projectConfig, objectsArray, err := deserializeProjectObjects(data, deletePayload.ObjectArrayPath, objectType, projectID)
	if err != nil {
		return nil, err
	}

	if deletePayload.ObjectArrayPath == "" && objectsArray == nil {
		//single object (geo data resolver or telemetry)
		//just delete it
		if err := cs.delete(objectType, projectID); err != nil {
			return nil, err
		}
		return data, nil
	}

	objectPosition := unknownObjectPosition
	for i, objectI := range objectsArray {
		_, ok, err := findObject(i, objectI, objectType, projectID, deletePayload.ObjectMeta)
		if err != nil {
			return nil, err
		}
		if ok {
			objectPosition = i
			break
		}
	}

	if objectPosition == unknownObjectPosition {
		return nil, fmt.Errorf("object hasn't been found by id in path [%s] in the collection", deletePayload.ObjectArrayPath)
	}

	//save without foundObject
	objectToDelete := objectsArray[objectPosition]
	newObjectsArray := append(objectsArray[:objectPosition], objectsArray[objectPosition+1:]...)
	projectConfig[deletePayload.ObjectArrayPath] = newObjectsArray

	if _, err := cs.save(objectType, projectID, projectConfig); err != nil {
		return nil, err
	}
	if err != nil {
		return nil, err
	}

	deletedObjectBytes, err := json.Marshal(objectToDelete)
	if err != nil {
		return nil, fmt.Errorf("error serializing deleted object: %v", err)
	}

	return deletedObjectBytes, nil
}

//GetObjectWithLock locks by collection and projectID, gets object by objectUID and returns it
func (cs *ConfigurationsService) GetObjectWithLock(objectType, projectID, objectArrayPath string, objectMeta *ObjectMeta) ([]byte, error) {
	lock, err := cs.lockProjectObject(objectType, projectID)
	if err != nil {
		return nil, err
	}
	defer lock.Unlock()

	data, err := cs.get(objectType, projectID)
	if err != nil {
		return nil, err
	}

	_, objectsArray, err := deserializeProjectObjects(data, objectArrayPath, objectType, projectID)
	if err != nil {
		return nil, err
	}

	for i, objectI := range objectsArray {
		foundObject, ok, err := findObject(i, objectI, objectType, projectID, objectMeta)
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

func (cs *ConfigurationsService) LinkUserToProject(userID, projectID string) error {
	return cs.storage.AddRelatedIDs(userProjectRelation, userID, projectID)
}

func (cs *ConfigurationsService) UnlinkUserFromProject(userID, projectID string) error {
	return cs.storage.DeleteRelatedIDs(userProjectRelation, userID, projectID)
}

func (cs *ConfigurationsService) UnlinkUserFromAllProjects(userID string) error {
	return cs.storage.DeleteRelation(userProjectRelation, userID)
}

func (cs *ConfigurationsService) GetAllProjects() ([]openapi.Project, error) {
	projectsData, err := cs.storage.GetAllGroupedByID(projectSettingsCollection)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load all projects")
	}

	projects := make([]openapi.Project, 0, len(projectsData))
	for projectID, projectData := range projectsData {
		var project openapi.Project
		if err := json.Unmarshal(projectData, &project); err != nil {
			return nil, errors.Wrapf(err, "unmarshal project %s", projectID)
		}

		projects = append(projects, project)
	}

	return projects, nil
}

func (cs *ConfigurationsService) GetUserProjects(userID string) ([]string, error) {
	return cs.storage.GetRelatedIDs(userProjectRelation, userID)
}

func (cs *ConfigurationsService) GetProjectUsers(projectID string) ([]string, error) {
	if err := cs.Load(projectID, new(Project)); err != nil {
		return nil, err
	}

	index, err := cs.storage.GetRelationIndex(userProjectRelation)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get user project relation index")
	}

	userIDs := make(common.StringSet)
	for _, userID := range index {
		if relatedProjectIDs, err := cs.storage.GetRelatedIDs(userProjectRelation, userID); err != nil {
			return nil, errors.Wrapf(err, "failed to get related projects for user %s", userID)
		} else {
			for _, relatedProjectID := range relatedProjectIDs {
				if relatedProjectID == projectID {
					userIDs[userID] = true
					break
				}
			}
		}
	}

	return userIDs.Values(), nil
}

func (cs *ConfigurationsService) Create(value CollectionItem, patch interface{}) error {
	if _, err := cs.Patch(random.LowerString(22), value, patch, false); err != nil {
		return errors.Wrapf(err, "failed to patch %s", value.Collection())
	} else {
		return nil
	}
}

func (cs *ConfigurationsService) UpdateUserInfo(id string, patch interface{}) (*RedisUserInfo, error) {
	var result RedisUserInfo
	if patched, err := cs.Patch(id, &result, patch, false); err != nil {
		return nil, errors.Wrap(err, "failed to patch user info")
	} else if patched {
		if projectInfo := result.Project; projectInfo != nil {
			projectID := projectInfo.Id
			patch := openapi.Project{
				Id:            projectID,
				Name:          projectInfo.Name,
				RequiresSetup: projectInfo.RequireSetup,
			}

			if _, err := cs.Patch(projectID, new(Project), patch, false); err != nil {
				return nil, errors.Wrap(err, "faild to patch project")
			} else if err := cs.LinkUserToProject(id, projectID); err != nil {
				return nil, errors.Wrap(err, "failed to link user to project")
			}
		}
	}

	return &result, nil
}

func (cs *ConfigurationsService) GetUserInfo(id string) (*RedisUserInfo, error) {
	var result RedisUserInfo
	if err := cs.Load(id, &result); err != nil {
		return nil, errors.Wrap(err, "failed to load user info")
	}

	if projectInfo := result.Project; projectInfo != nil {
		var project Project
		if err := cs.Load(projectInfo.Id, &project); err != nil {
			return nil, errors.Wrap(err, "failed to load project from user info")
		}

		result.Project = &openapi.ProjectInfo{
			Id:           project.Id,
			Name:         project.Name,
			RequireSetup: project.RequiresSetup,
		}
	}

	return &result, nil
}

func (cs *ConfigurationsService) Load(id string, value CollectionItem) error {
	if data, err := cs.get(value.Collection(), id); err != nil {
		return errors.Wrapf(err, "failed to get %s with lock", value.Collection())
	} else if err := json.Unmarshal(data, value); err != nil {
		return errors.Wrapf(err, "unmarshal %s value", value.Collection())
	} else {
		return nil
	}
}

// patchHandler defines a strategy during Patch.
// A handler is responsible for unmarshaling of the stored object as well as calling the value handlers.
type patchHandler interface {
	// beforePatch is called before the patch is applied to the value.
	beforePatch(data []byte, value CollectionItem) error
	// afterPatch is called after the patch is applied to the value.
	// apply should be false if the value is not to be persisted.
	afterPatch(value CollectionItem) (apply bool, err error)
}

type createPatchHandler struct {
	id string
}

func (createPatchHandler) beforePatch([]byte, CollectionItem) error {
	return nil
}

func (h createPatchHandler) afterPatch(value CollectionItem) (bool, error) {
	if handler, ok := value.(OnCreateHandler); ok {
		handler.OnCreate(h.id)
	}

	return true, nil
}

// updatePatchHandler is a map containing original state of the object.
// This is a type alias for brevity of instantiation.
type updatePatchHandler map[string]interface{}

func (h updatePatchHandler) unmask() map[string]interface{} {
	return h
}

func (h updatePatchHandler) beforePatch(data []byte, value CollectionItem) error {
	if err := json.Unmarshal(data, value); err != nil {
		return errors.Wrap(err, "unmarshal")
	}

	if err := common.DecodeAsJSON(value, &h); err != nil {
		return errors.Wrap(err, "decode original values")
	}

	return nil
}

func (h updatePatchHandler) afterPatch(value CollectionItem) (apply bool, err error) {
	var values map[string]interface{}
	if err := common.DecodeAsJSON(value, &values); err != nil {
		return false, errors.Wrap(err, "decode updated values")
	}

	if reflect.DeepEqual(h.unmask(), values) {
		return false, nil
	}

	if handler, ok := value.(OnUpdateHandler); ok {
		handler.OnUpdate()
	}

	return true, nil
}

// Patch patches the collection item.
//   `id` is the ID of the collection item.
//   `value` should be an empty initialized pointer to the value of the target type. Slices are currently not supported.
//	 `patch` may be anything that is acceptable for json.Marshal. Must define an object (not array or value).
//	 `requireExist` indicates if the object with the specified ID must already exist. See patchHandler docs for more info.
func (cs *ConfigurationsService) Patch(id string, value CollectionItem, patch interface{}, requireExist bool) (bool, error) {
	if lock, err := cs.lockProjectObject(value.Collection(), id); err != nil {
		return false, err
	} else {
		defer lock.Unlock()
	}

	var handler patchHandler
	data, err := cs.get(value.Collection(), id)
	switch {
	case err == nil:
		handler = updatePatchHandler{}
	case errors.Is(err, ErrConfigurationNotFound) && !requireExist:
		handler = createPatchHandler{id}
	default:
		return false, errors.Wrap(err, "get")
	}

	if err := handler.beforePatch(data, value); err != nil {
		return false, errors.Wrap(err, "before patch")
	}

	if err := common.DecodeAsJSON(patch, value); err != nil {
		return false, errors.Wrap(err, "apply patch")
	}

	if apply, err := handler.afterPatch(value); err != nil {
		return false, errors.Wrap(err, "after patch")
	} else if !apply {
		return false, nil
	}

	if _, err := cs.save(value.Collection(), id, value); err != nil {
		return false, errors.Wrap(err, "save")
	}

	return true, nil
}

func (cs *ConfigurationsService) Delete(id string, value CollectionItem) error {
	if err := cs.delete(value.Collection(), id); err != nil {
		return errors.Wrapf(err, "delete %s", value.Collection())
	} else {
		return nil
	}
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

func (cs *ConfigurationsService) lockProjectObject(objectType, projectID string) (locks.Lock, error) {
	lock := cs.lockFactory.CreateLock(getObjectLockIdentifier(objectType, projectID))
	locked, err := lock.TryLock(defaultProjectObjectLockTimeout)
	if err != nil {
		msg := fmt.Sprintf("System error: failed to lock project [%s] object type [%s]: %v", projectID, objectType, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}

	if !locked {
		return nil, fmt.Errorf("unable to lock project [%s] object type [%s]. Already locked: timeout after %s", projectID, objectType, defaultProjectObjectLockTimeout.String())
	}

	return lock, nil
}

//GetObjectArrayPathByObjectType returns paths in JSON
//some entities arrays can be different from entity type
func (cs *ConfigurationsService) GetObjectArrayPathByObjectType(objectType string) string {
	switch objectType {
	case apiKeysCollection:
		return "keys"
	case geoDataResolversCollection:
		return ""
	case telemetryCollection:
		return ""
	case customDomainsCollection:
		return "domains"
	default:
		return objectType
	}
}

//GetObjectIDField returns id field name by object type
func (cs *ConfigurationsService) GetObjectIDField(objectType string) string {
	switch objectType {
	case apiKeysCollection:
		return "uid"
	case sourcesCollection:
		return "sourceId"
	default:
		return "_uid"
	}
}

//GetObjectTypeField returns type field name
func (cs *ConfigurationsService) GetObjectTypeField(objectType string) string {
	switch objectType {
	case sourcesCollection:
		return "sourceType"
	case destinationsCollection:
		return "_type"
	default:
		return ""
	}
}

//GenerateID returns auto incremented ID based on jserver entity type
func (cs *ConfigurationsService) GenerateID(typeField, objectType, projectID string, object *openapi.AnyObject, alreadyUsedIDs map[string]bool) string {
	if typeField == "" {
		if objectType == apiKeysCollection {
			return generateAPIKeyID(projectID)
		}

		return generateUniqueID(random.LowerString(20), alreadyUsedIDs)
	}

	t, ok := object.Get(typeField)
	jServerEntityType := fmt.Sprint(t)
	if !ok || jServerEntityType == "" {
		logging.Errorf("failed to get type field [%s] from object: %v", typeField, object.AdditionalProperties)
		return generateUniqueID(random.LowerString(20), alreadyUsedIDs)
	}

	//get prefix for generating ID based on different field for airbyte and singer (since there sourceType=airbyte or singer)
	if jServerEntityType == airbyteType {
		airbyteSourceType, err := extractAirbyteSourceType(object)
		if err != nil {
			logging.Errorf("failed to get airbyte source type for generating config from object %v: %v. Autogenerated ID will be set", object.AdditionalProperties, err)
		} else {
			jServerEntityType = airbyteSourceType
		}
	} else if jServerEntityType == singerType {
		singerSourceType, err := extractSingerSourceType(object)
		if err != nil {
			logging.Errorf("failed to get singer source type for generating config from object %v: %v. Autogenerated ID will be set", object.AdditionalProperties, err)
		} else {
			jServerEntityType = singerSourceType
		}
	}

	return generateUniqueID(jServerEntityType, alreadyUsedIDs)
}

func extractAirbyteSourceType(object *openapi.AnyObject) (string, error) {
	objConfigI, ok := object.Get(configField)
	if !ok {
		return "", fmt.Errorf("%s field doesn't exist", configField)
	}

	objConfig, ok := objConfigI.(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("value under %s field isn't an object", configField)
	}

	airbyteTypeValue, ok := objConfig[airbyteTypeField]
	if !ok {
		return "", fmt.Errorf("field %s doesn't exist in the object under %s key", airbyteTypeField, configField)
	}

	return strings.TrimLeft(fmt.Sprint(airbyteTypeValue), "source-"), nil
}

func extractSingerSourceType(object *openapi.AnyObject) (string, error) {
	objConfigI, ok := object.Get(configField)
	if !ok {
		return "", fmt.Errorf("%s field doesn't exist", configField)
	}

	objConfig, ok := objConfigI.(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("value under %s field isn't an object", configField)
	}

	singerTypeValue, ok := objConfig[singerTypeField]
	if !ok {
		return "", fmt.Errorf("field %s doesn't exist in the object under %s key", singerTypeField, configField)
	}

	return strings.TrimLeft(fmt.Sprint(singerTypeValue), "tap-"), nil
}

//buildProjectDataObject puts input object into array with position and into projectData with arrayPath (if arrayPath is empty puts as is)
//depends on the arrayPath can return { array_path: []objects} or just { object ... }
func buildProjectDataObject(projectData map[string]interface{}, array []map[string]interface{}, object map[string]interface{}, position int, arrayPath string) map[string]interface{} {
	if arrayPath != "" {
		if array == nil {
			array = make([]map[string]interface{}, 0, 1)
		}

		if position != unknownObjectPosition {
			array[position] = object
		} else {
			array = append(array, object)
		}

		if projectData == nil {
			projectData = map[string]interface{}{}
		}

		projectData[arrayPath] = array
		return projectData
	} else {
		return object
	}
}

//deserializeProjectObjects returns high level object wrapper (which is stored in Redis) and underlying deserialized objects array
// { array_path: [objects..], other_field1: ..., other_fieldN:...}
// if array_path is "" just return serialized object
func deserializeProjectObjects(projectObjectsBytes []byte, arrayPath, objectType, projectID string) (map[string]interface{}, []map[string]interface{}, error) {
	collectionData := map[string]interface{}{}
	if err := json.Unmarshal(projectObjectsBytes, &collectionData); err != nil {
		return nil, nil, fmt.Errorf("error unmarshal data: %v", err)
	}

	if arrayPath == "" {
		return collectionData, nil, nil
	}

	objectsArrayI, ok := collectionData[arrayPath]
	if !ok {
		return nil, nil, fmt.Errorf("path [%s] doesn't exist in the collection", arrayPath)
	}

	objectsArray, ok := objectsArrayI.([]interface{})
	if !ok {
		return nil, nil, fmt.Errorf("path [%s] is not an array (is %T) in the collection", arrayPath, objectsArrayI)
	}

	result := make([]map[string]interface{}, len(objectsArray))
	for i, objectI := range objectsArray {
		object, ok := objectI.(map[string]interface{})
		if !ok {
			logging.Infof("element [%T: %v] isn't an object in path [%s] in the %s collection by %s ID", objectI, objectI, arrayPath, objectType, projectID)
			return nil, nil, fmt.Errorf("element with index: %d isn't an object in path [%s] in the collection", i, arrayPath)
		}
		result[i] = object
	}

	return collectionData, result, nil
}

func ensureIDNotChanged(patchPayload *PatchPayload) {
	//keep old id
	currentID, ok := patchPayload.Patch[patchPayload.ObjectMeta.IDFieldPath]
	if !ok || fmt.Sprint(currentID) != patchPayload.ObjectMeta.Value {
		patchPayload.Patch[patchPayload.ObjectMeta.IDFieldPath] = patchPayload.ObjectMeta.Value
	}
}

//findObject returns object and true if input objectI has the same ID as in objectMeta
func findObject(i int, object map[string]interface{}, collection, projectID string, objectMeta *ObjectMeta) (map[string]interface{}, bool, error) {
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
			ID:           generateAPIKeyID(projectID),
			ClientSecret: "js." + projectID + "." + random.LowerString(21),
			ServerSecret: "s2s." + projectID + "." + random.LowerString(21),
		}},
	}
}

func generateAPIKeyID(projectID string) string {
	return projectID + "." + random.LowerString(6)
}

func getObjectLockIdentifier(objectType, projectID string) string {
	return objectType + "_" + projectID
}

//generateUniqueID generated id in format: base + i, where i if previous value of i has already been used
func generateUniqueID(base string, alreadyUsedIDs map[string]bool) string {
	id := base
	_, used := alreadyUsedIDs[id]
	i := 0
	for used && i < 10000 {
		i++
		id = fmt.Sprintf("%s%d", base, i)
		_, used = alreadyUsedIDs[id]
	}

	if used {
		return random.LowerString(20)
	}

	return id
}
