package airbyte

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/schema"
)

const (
	syncModeIncremental = "incremental"
	syncModeFullRefresh = "full_refresh"
)

//dbDockerImages db sources doesn't support increment sync mode yet
var dbDockerImages = map[string]bool{
	"source-postgres": true,
	"source-mssql":    true,
	"source-oracle":   true,
	"source-mysql":    true,
}

//reformatCatalog reformat raw Airbyte catalog (Airbyte discovers and consumes on read command different catalogs formats)
//returns reformatted catalog bytes, streams representation and err if occurred
func reformatCatalog(dockerImage string, rawCatalog *airbyte.CatalogRow) ([]byte, map[string]*base.StreamRepresentation, error) {
	formattedCatalog := &airbyte.Catalog{}
	streamsRepresentation := map[string]*base.StreamRepresentation{}
	for _, stream := range rawCatalog.Streams {
		syncMode := getSyncMode(dockerImage, stream)
		var cursorField []string = nil
		if stream.SourceDefinedCursor {
			cursorField = stream.DefaultCursorField
		} else if len(stream.SelectedCursorField) > 0 {
			cursorField = stream.SelectedCursorField
		}
		//formatted catalog
		formattedCatalog.Streams = append(formattedCatalog.Streams, &airbyte.WrappedStream{
			SyncMode: syncMode,
			//isn't used because Jitsu doesn't use airbyte destinations. Just should be a valid option.
			DestinationSyncMode: "overwrite",
			Stream:              stream,
			CursorField:         cursorField,
		})

		//streams schema representation
		streamSchema := schema.Fields{}
		base.ParseProperties(base.AirbyteType, "", stream.JsonSchema.Properties, streamSchema)

		var keyFields []string
		for _, sourceDefinedPrimaryKeys := range stream.SourceDefinedPrimaryKey {
			if len(sourceDefinedPrimaryKeys) > 0 {
				keyFields = sourceDefinedPrimaryKeys
			}
		}

		streamsRepresentation[stream.Name] = &base.StreamRepresentation{
			Namespace:  stream.Namespace,
			StreamName: stream.Name,
			BatchHeader: &schema.BatchHeader{
				TableName: stream.Name,
				Fields:    streamSchema,
			},
			KeyFields: keyFields,
			Objects:   []map[string]interface{}{},
			//Set need clean only if full refresh => table will be truncated before data storing
			NeedClean: syncMode == syncModeFullRefresh,
		}
	}

	b, _ := json.MarshalIndent(formattedCatalog, "", "    ")

	return b, streamsRepresentation, nil
}

//parseFormattedCatalog parses formatted catalog from (UI/input)
func parseFormattedCatalog(catalogIface interface{}) (map[string]*base.StreamRepresentation, error) {
	b, _ := json.Marshal(catalogIface)
	catalog := &airbyte.Catalog{}
	if err := json.Unmarshal(b, catalog); err != nil {
		return nil, fmt.Errorf("can't unmarshal into airbyte.Catalog{}: %v", err)
	}

	streamsRepresentation := map[string]*base.StreamRepresentation{}
	for _, stream := range catalog.Streams {
		var keyFields []string
		for _, sourceDefinedPrimaryKeys := range stream.Stream.SourceDefinedPrimaryKey {
			if len(sourceDefinedPrimaryKeys) > 0 {
				keyFields = sourceDefinedPrimaryKeys
			}
		}

		//streams schema representation
		streamSchema := schema.Fields{}
		base.ParseProperties(base.AirbyteType, "", stream.Stream.JsonSchema.Properties, streamSchema)

		streamsRepresentation[stream.Stream.Name] = &base.StreamRepresentation{
			Namespace:  stream.Stream.Namespace,
			StreamName: stream.Stream.Name,
			BatchHeader: &schema.BatchHeader{
				TableName: stream.Stream.Name,
				Fields:    streamSchema,
			},
			KeyFields: keyFields,
			Objects:   []map[string]interface{}{},
			//Set need clean only if full refresh => table will be truncated before data storing
			NeedClean: stream.SyncMode == syncModeFullRefresh,
		}
	}

	return streamsRepresentation, nil
}

//getSyncMode returns incremental if supported
//otherwise returns first
//for DB source returns not incremental
func getSyncMode(dockerImage string, stream *airbyte.Stream) string {
	if stream.SyncMode != "" {
		return stream.SyncMode
	}

	if _, ok := dbDockerImages[dockerImage]; ok {
		return syncModeFullRefresh
	}

	if len(stream.SupportedSyncModes) == 0 {
		return syncModeIncremental
	}

	for _, supportedSyncMode := range stream.SupportedSyncModes {
		if supportedSyncMode == syncModeIncremental {
			return syncModeIncremental
		}
	}

	return stream.SupportedSyncModes[0]
}
