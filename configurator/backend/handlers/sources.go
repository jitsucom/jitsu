package handlers

import (
	"encoding/json"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/jitsu"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/airbyte"
	jdrivers "github.com/jitsucom/jitsu/server/drivers"
	jdriversairbyte "github.com/jitsucom/jitsu/server/drivers/airbyte"
	jdriversbase "github.com/jitsucom/jitsu/server/drivers/base"
	jdriverssinger "github.com/jitsucom/jitsu/server/drivers/singer"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	jsources "github.com/jitsucom/jitsu/server/sources"
	jstorages "github.com/jitsucom/jitsu/server/storages"
	"net/http"
	"time"
)

const SourcesGettingErrMsg = "Sources getting error"

type SourcesHandler struct {
	configurationsService *storages.ConfigurationsService

	enService *jitsu.Service
}

func NewSourcesHandler(configurationsService *storages.ConfigurationsService, enService *jitsu.Service) *SourcesHandler {
	return &SourcesHandler{
		configurationsService: configurationsService,
		enService:             enService,
	}
}

func (sh *SourcesHandler) GetHandler(c *gin.Context) {
	begin := time.Now()
	sourcesMap, err := sh.configurationsService.GetSources()
	if err != nil {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse(SourcesGettingErrMsg, err))
		return
	}
	idConfig := map[string]jdriversbase.SourceConfig{}
	for projectID, sourcesEntity := range sourcesMap {
		if len(sourcesEntity.Sources) == 0 {
			continue
		}
		dests, err := sh.configurationsService.GetDestinationsByProjectID(projectID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse(SourcesGettingErrMsg, err))
			return
		}
		postHandleDestinationIds := make([]string, 0)
		for _, d := range dests {
			if d.Type == jstorages.DbtCloudType {
				postHandleDestinationIds = append(postHandleDestinationIds, projectID+"."+d.UID)
			}
		}
		for _, source := range sourcesEntity.Sources {
			sourceID := projectID + "." + source.SourceID

			var destinationIDs []string
			for _, destinationID := range source.Destinations {
				destinationIDs = append(destinationIDs, projectID+"."+destinationID)
			}
			mappedSourceConfig, err := mapSourceConfig(source, destinationIDs, postHandleDestinationIds)
			if err != nil {
				c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(fmt.Sprintf("Failed to map source [%s] config", sourceID), err))
				return
			}

			idConfig[sourceID] = mappedSourceConfig
		}
	}

	logging.Debugf("Sources response in [%.2f] seconds", time.Now().Sub(begin).Seconds())
	c.JSON(http.StatusOK, &jsources.Payload{Sources: idConfig})
}

func (sh *SourcesHandler) TestHandler(c *gin.Context) {
	sourceEntity := &entities.Source{}
	err := c.BindJSON(sourceEntity)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Failed to parse request body", err))
		return
	}

	userProjectID := c.GetString(middleware.ProjectIDKey)
	if userProjectID == "" {
		logging.SystemError(ErrProjectIDNotFoundInContext)
		c.JSON(http.StatusUnauthorized, jmiddleware.ErrResponse("Project authorization error", ErrProjectIDNotFoundInContext))
		return
	}

	enSourceConfig, err := mapSourceConfig(sourceEntity, []string{}, []string{})
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(fmt.Sprintf("Failed to map source [%s.%s] config", userProjectID, sourceEntity.SourceID), err))
		return
	}

	sourceID := userProjectID + "." + sourceEntity.SourceID
	enSourceConfig.SourceID = sourceID

	b, err := json.Marshal(enSourceConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Failed to serialize source config", err))
		return
	}

	code, content, err := sh.enService.TestSource(b)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Failed to get response from Jitsu Server", err))
		return
	}

	if code == http.StatusOK {
		sr := &jmiddleware.StatusResponse{}
		err := json.Unmarshal(content, sr)
		if err != nil {
			c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Failed to read response from Jitsu Server", err))
			return
		}

		c.JSON(http.StatusOK, sr)
		return
	}

	c.Header("Content-Type", jsonContentType)
	c.Writer.WriteHeader(code)

	_, err = c.Writer.Write(content)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Failed to write response", err))
	}
}

//mapSourceConfig mapped configurator source into server format
//puts table names if not set
func mapSourceConfig(source *entities.Source, sourceDestinationIDs []string, postHandleDestinations []string) (jdriversbase.SourceConfig, error) {
	enSource := jdriversbase.SourceConfig{
		SourceID:               source.SourceID,
		Type:                   source.SourceType,
		Destinations:           sourceDestinationIDs,
		PostHandleDestinations: postHandleDestinations,
		Collections:            source.Collections,
		Config:                 source.Config,
		Schedule:               source.Schedule,
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
