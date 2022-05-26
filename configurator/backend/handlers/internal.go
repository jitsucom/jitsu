package handlers

import (
	"context"
	"encoding/json"

	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/config"
	jdrivers "github.com/jitsucom/jitsu/server/drivers"
	jdriversairbyte "github.com/jitsucom/jitsu/server/drivers/airbyte"
	jdriversbase "github.com/jitsucom/jitsu/server/drivers/base"
	jdriverssinger "github.com/jitsucom/jitsu/server/drivers/singer"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	jstorages "github.com/jitsucom/jitsu/server/storages"
	"github.com/pkg/errors"
)

func (oa *OpenAPI) getProjectUsers(ctx context.Context, projectID string) ([]openapi.UserBasicInfo, error) {
	if userIDs, err := oa.Configurations.GetProjectUsers(projectID); err != nil {
		return nil, errors.Wrap(err, "get project users")
	} else {
		users := make([]openapi.UserBasicInfo, 0, len(userIDs))
		for _, userID := range userIDs {
			if email, err := oa.Authorizator.GetUserEmail(ctx, userID); err != nil {
				logging.Warnf("Failed to find user email for ID %s: %s", userID, err)
			} else {
				users = append(users, openapi.UserBasicInfo{
					Id:    userID,
					Email: email,
				})
			}
		}

		return users, nil
	}
}

func (oa *OpenAPI) mapDestinationsConfiguration(
	apiKeysPerProjectByID map[string]map[string]entities.APIKey,
	destinationsByProjectID map[string]*entities.Destinations) (
	map[string]config.DestinationConfig, error,
) {
	geoResolvers, err := oa.Configurations.GetGeoDataResolvers()
	if err != nil {
		logging.SystemErrorf("Error getting geo resolvers: %v", err)
		geoResolvers = map[string]*entities.GeoDataResolver{}
	}

	destinationConfigs := make(map[string]config.DestinationConfig)
	for projectID, entity := range destinationsByProjectID {
		if len(entity.Destinations) == 0 {
			continue
		}

		postHandleDestinationIDs := make([]string, 0)
		for _, dest := range entity.Destinations {
			if dest.Type == jstorages.DbtCloudType {
				postHandleDestinationIDs = append(postHandleDestinationIDs, projectID+"."+dest.UID)
			}
		}

		for _, destination := range entity.Destinations {
			destinationID := projectID + "." + destination.UID
			destinationConfig, err := destinations.MapConfig(destinationID, destination, oa.DefaultS3, postHandleDestinationIDs)
			if err != nil {
				logging.Errorf("Error mapping destination config for destination type: %s id: %s projectID: %s err: %v", destination.Type, destination.UID, projectID, err)
				continue
			}

			//connect with geo resolver
			if geoResolverConfig, ok := geoResolvers[projectID]; ok && geoResolverConfig.MaxMind != nil && geoResolverConfig.MaxMind.Enabled {
				destinationConfig.GeoDataResolverID = projectID
			}

			//check api keys existence
			if projectsApikeysByID, ok := apiKeysPerProjectByID[projectID]; ok {
				projectApiKeysInOnlyTokens := make([]string, 0, len(destinationConfig.OnlyTokens))
				for _, apiKeyID := range destinationConfig.OnlyTokens {
					if _, ok := projectsApikeysByID[apiKeyID]; ok {
						projectApiKeysInOnlyTokens = append(projectApiKeysInOnlyTokens, apiKeyID)
					}
				}

				destinationConfig.OnlyTokens = projectApiKeysInOnlyTokens
			}

			destinationConfigs[destinationID] = *destinationConfig
		}
	}

	return destinationConfigs, nil
}

func (oa *OpenAPI) mapSourcesConfiguration(sourcesByProjectID map[string]*entities.Sources) (map[string]jdriversbase.SourceConfig, error) {
	sourceConfigs := make(map[string]jdriversbase.SourceConfig, len(sourcesByProjectID))
	for projectID, entity := range sourcesByProjectID {
		if len(entity.Sources) == 0 {
			continue
		}

		destinationsByProjectID, err := oa.Configurations.GetDestinationsByProjectID(projectID)
		if err != nil {
			return nil, errors.Wrapf(err, "get destinations for project %s", projectID)
		}

		postHandleDestinationIDs := make([]string, 0)
		for _, dest := range destinationsByProjectID {
			if dest.Type == jstorages.DbtCloudType {
				postHandleDestinationIDs = append(postHandleDestinationIDs, projectID+"."+dest.UID)
			}
		}

		var project entities.Project
		if err := oa.Configurations.Load(projectID, &project); err != nil {
			return nil, errors.Wrapf(err, "get project for id %s", projectID)
		}

		for _, source := range entity.Sources {
			sourceID := projectID + "." + source.SourceID
			destinationIDs := make([]string, len(source.Destinations))
			for i, destinationID := range source.Destinations {
				destinationIDs[i] = projectID + "." + destinationID
			}

			sourceConfig, err := mapSourceConfig(source, destinationIDs, postHandleDestinationIDs, project)
			if err != nil {
				return nil, errors.Wrapf(err, "map source %s config", sourceID)
			}

			sourceConfigs[sourceID] = sourceConfig
		}
	}

	return sourceConfigs, nil
}

func mapYamlDestinations(projectDestinations []*entities.Destination) ([]string, map[string]*config.DestinationConfig, error) {
	postHandleDestinationIDs := make([]string, 0)
	for _, dest := range projectDestinations {
		if dest.Type == jstorages.DbtCloudType {
			postHandleDestinationIDs = append(postHandleDestinationIDs, dest.UID)
		}
	}

	destinationConfigs := make(map[string]*config.DestinationConfig, len(projectDestinations))
	for _, destination := range projectDestinations {
		destinationID := destination.UID
		destinationConfig, err := destinations.MapConfig(destinationID, destination, stubS3Config, postHandleDestinationIDs)
		if err != nil {
			return nil, nil, errors.Wrapf(err, "map config for destination [%s]", destinationID)
		}

		destinationConfigs[destinationID] = destinationConfig
	}

	return postHandleDestinationIDs, destinationConfigs, nil
}

func mapYamlSources(projectSources []*entities.Source, postHandleDestinationIDs []string, project entities.Project) (map[string]*jdriversbase.SourceConfig, error) {
	sourceConfigs := make(map[string]*jdriversbase.SourceConfig)
	for _, source := range projectSources {
		sourceID := source.SourceID
		destinationIDs := source.Destinations
		sourceConfig, err := mapSourceConfig(source, destinationIDs, postHandleDestinationIDs, project)
		if err != nil {
			return nil, errors.Wrapf(err, "map config for source [%s]", sourceID)
		}

		sourceConfigs[sourceID] = &sourceConfig
	}

	return sourceConfigs, nil
}

//mapSourceConfig mapped configurator source into server format
//puts table names if not set
func mapSourceConfig(source *entities.Source, sourceDestinationIDs []string, postHandleDestinations []string, projectSettings entities.Project) (jdriversbase.SourceConfig, error) {
	var notificationConfig map[string]interface{}
	if projectSettings.Notifications != nil {
		notificationConfig = map[string]interface{}{
			"slack": projectSettings.Notifications.Slack,
		}
	}

	enSource := jdriversbase.SourceConfig{
		SourceID:               source.SourceID,
		Type:                   source.SourceType,
		Destinations:           sourceDestinationIDs,
		PostHandleDestinations: postHandleDestinations,
		Collections:            source.Collections,
		Config:                 source.Config,
		Schedule:               source.Schedule,
		Notifications:          notificationConfig,
		ProjectName:            projectSettings.Name,
	}

	if source.SourceType == jdriversbase.SingerType {
		if err := enrichWithSingerTableNamesMapping(&enSource); err != nil {
			return jdriversbase.SourceConfig{}, err
		}
	} else if source.SourceType == jdriversbase.AirbyteType {
		if err := enrichWithAirbyteTableNamesMapping(&enSource); err != nil {
			return jdriversbase.SourceConfig{}, err
		}
	} else {
		//process collections if not Singer
		collections, err := jdrivers.ParseCollections(&enSource)
		if err != nil {
			return jdriversbase.SourceConfig{}, err
		}

		//enrich with table names = source (without project + collection name)
		for _, col := range collections {
			if col.TableName == "" {
				col.TableName = source.SourceID + "_" + col.Name
			}
		}

		var collectionsInterface []interface{}
		for _, col := range collections {
			collectionsInterface = append(collectionsInterface, col)
		}
		enSource.Collections = collectionsInterface
	}

	return enSource, nil
}

//enrichWithSingerTableNamesMapping enriches with table names = source (without project + singer stream)
// - gets stream names from JSON
// - puts it with sourceID prefix into mapping map
func enrichWithSingerTableNamesMapping(enSource *jdriversbase.SourceConfig) error {
	config := &jdriverssinger.Config{}
	if err := jsonutils.UnmarshalConfig(enSource.Config, config); err != nil {
		return err
	}

	//enrich with table name mapping or table name prefix
	if config.Catalog != nil {
		var catalogBytes []byte
		switch config.Catalog.(type) {
		case string:
			catalogBytes = []byte(config.Catalog.(string))
		default:
			catalogBytes, _ = json.Marshal(config.Catalog)
		}

		catalog := &jdriverssinger.Catalog{}
		if err := json.Unmarshal(catalogBytes, catalog); err != nil {
			return err
		}

		streamNameTableNameMapping := map[string]string{}
		for _, stream := range catalog.Streams {
			streamNameTableNameMapping[stream.Stream] = enSource.SourceID + "_" + stream.Stream
			streamNameTableNameMapping[stream.TapStreamID] = enSource.SourceID + "_" + stream.TapStreamID
		}
		config.StreamTableNames = streamNameTableNameMapping
	} else {
		config.StreamTableNamesPrefix = enSource.SourceID + "_"
	}

	serializedConfig := map[string]interface{}{}
	if err := jsonutils.UnmarshalConfig(config, &serializedConfig); err != nil {
		return err
	}

	enSource.Config = serializedConfig
	return nil
}

//enrichWithAirbyteTableNamesMapping enriches with table names = source (without project + airbyte stream)
// - gets stream names from JSON
// - puts it with sourceID prefix into mapping map
func enrichWithAirbyteTableNamesMapping(enSource *jdriversbase.SourceConfig) error {
	config := &jdriversairbyte.Config{}
	if err := jsonutils.UnmarshalConfig(enSource.Config, config); err != nil {
		return err
	}

	//enrich with table name mapping or table name prefix
	if config.Catalog != nil {
		var catalogBytes []byte
		switch config.Catalog.(type) {
		case string:
			catalogBytes = []byte(config.Catalog.(string))
		default:
			catalogBytes, _ = json.Marshal(config.Catalog)
		}

		catalog := &airbyte.Catalog{}
		if err := json.Unmarshal(catalogBytes, catalog); err != nil {
			return err
		}

		streamNameTableNameMapping := map[string]string{}
		for _, stream := range catalog.Streams {
			streamNameTableNameMapping[stream.Stream.Name] = enSource.SourceID + "_" + stream.Stream.Name
		}
		config.StreamTableNames = streamNameTableNameMapping
	} else {
		config.StreamTableNamesPrefix = enSource.SourceID + "_"
	}

	serializedConfig := map[string]interface{}{}
	if err := jsonutils.UnmarshalConfig(config, &serializedConfig); err != nil {
		return err
	}

	enSource.Config = serializedConfig
	return nil
}
