package singer

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/schema"
	"io/ioutil"
)

type SingerSettingsExtractor struct {
	Catalog    *SingerCatalog
	Properties *SingerCatalog
}

func NewFileBasedSingerSettingsExtractor(catalogPath, propertiesPath string) (*SingerSettingsExtractor, error) {
	singerSettingsExtractor := SingerSettingsExtractor{}
	if catalogPath != "" {
		err := loadCatalogFromFile(catalogPath, &singerSettingsExtractor)
		if err != nil {
			return nil, err
		}
	}

	if propertiesPath != "" {
		err := loadPropertiesFromFile(propertiesPath, &singerSettingsExtractor)
		if err != nil {
			return nil, err
		}
	}

	return &singerSettingsExtractor, nil
}

func loadCatalogFromFile(path string, s *SingerSettingsExtractor) error {
	bytes, err := ioutil.ReadFile(path)
	if err != nil {
		return fmt.Errorf("Error reading catalog file: %v", err)
	}
	return s.LoadCatalog(bytes)
}

func loadPropertiesFromFile(path string, s *SingerSettingsExtractor) error {
	bytes, err := ioutil.ReadFile(path)
	if err != nil {
		return fmt.Errorf("Error reading properties file: %v", err)
	}
	return s.LoadProperties(bytes)
}

func (sse *SingerSettingsExtractor) LoadProperties(jsonBytes []byte) error {
	properties := &SingerCatalog{}
	err := json.Unmarshal(jsonBytes, properties)
	if err != nil {
		return err
	}
	sse.Properties = properties
	return nil
}

func (sse *SingerSettingsExtractor) LoadCatalog(jsonBytes []byte) error {
	catalog := &SingerCatalog{}
	err := json.Unmarshal(jsonBytes, catalog)
	if err != nil {
		return err
	}
	sse.Catalog = catalog
	return nil
}

func (sse *SingerSettingsExtractor) ExtractTableNamesMappings(prefix string) (map[string]string, error) {
	streamTableNamesMapping := map[string]string{}
	if sse.Catalog == nil {
		return streamTableNamesMapping, nil
	}

	for _, stream := range sse.Catalog.Streams {
		var streamName string
		if stream.Stream != "" {
			streamName = stream.Stream
		} else {
			streamName = stream.TapStreamID
		}
		var destTable string
		if stream.DestinationTableName != "" {
			destTable = stream.DestinationTableName
		} else {
			destTable = prefix + streamName
		}
		destTable = schema.Reformat(destTable)

		//add mapping stream
		if stream.Stream != "" {
			streamTableNamesMapping[stream.Stream] = destTable
		}
		//add mapping tap_stream_id
		if stream.TapStreamID != "" {
			streamTableNamesMapping[stream.TapStreamID] = destTable
		}

	}

	return streamTableNamesMapping, nil
}

func (sse *SingerSettingsExtractor) ExtractStreamReplicationMappings() (map[string]string, error) {
	var streams []SingerStreamCatalog
	if sse.Catalog != nil {
		streams = sse.Catalog.Streams
	} else if sse.Properties != nil {
		streams = sse.Properties.Streams
	} else {
		return map[string]string{}, nil
	}

	streamReplicationMapping := map[string]string{}

	for _, stream := range streams {
		for _, mw := range stream.Metadata {
			if len(mw.Breadcrumb) == 0 {
				metadata := mw.Metadata
				var replication string
				if len(metadata.ForcedReplicationMethod) > 0 {
					replication = metadata.ForcedReplicationMethod
				} else if len(metadata.ReplicationMethod) > 0 {
					replication = metadata.ReplicationMethod
				}
				if len(replication) > 0 {
					streamReplicationMapping[stream.Stream] = replication
				}
				break
			}
		}
	}

	return streamReplicationMapping, nil
}
