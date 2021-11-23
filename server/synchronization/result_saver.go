package synchronization

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/counters"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/uuid"
	"io/ioutil"
	"strings"
)

//ResultSaver is a Singer/Airbyte result consumer
//tap is a Singer tap or Airbyte source docker image
type ResultSaver struct {
	task              *meta.Task
	tap               string
	collectionMetaKey string
	tableNamePrefix   string
	taskLogger        *TaskLogger
	destinations      []storages.Storage
	metaStorage       meta.Storage
	//mapping stream name -> table name
	streamTableNames  map[string]string
	configPath 			  string
}

//NewResultSaver returns configured ResultSaver instance
func NewResultSaver(task *meta.Task, tap, collectionMetaKey, tableNamePrefix string, taskLogger *TaskLogger, destinations []storages.Storage, metaStorage meta.Storage, streamTableNames map[string]string, configPath string) *ResultSaver {
	return &ResultSaver{
		task:              task,
		tap:               tap,
		collectionMetaKey: collectionMetaKey,
		tableNamePrefix:   tableNamePrefix,
		taskLogger:        taskLogger,
		destinations:      destinations,
		metaStorage:       metaStorage,
		streamTableNames:  streamTableNames,
		configPath:        configPath,
	}
}

//Consume consumes result batch and writes it to destinations and saves the State
func (rs *ResultSaver) Consume(representation *driversbase.CLIOutputRepresentation) error {
	for streamName, stream := range representation.Streams {
		//airbyte can have empty objects
		if len(stream.Objects) == 0 {
			continue
		}

		tableName, ok := rs.streamTableNames[streamName]
		if !ok {
			tableName = rs.tableNamePrefix + streamName
		}
		stream.BatchHeader.TableName = schema.Reformat(tableName)

		rs.taskLogger.INFO("Stream [%s] Table name [%s] key fields [%s] objects [%d]", streamName, tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))

		//Note: we assume that destinations connected to 1 source can't have different unique ID configuration
		uniqueIDField := rs.destinations[0].GetUniqueIDField()
		stream.BatchHeader.Fields[uniqueIDField.GetFlatFieldName()] = schema.NewField(typing.STRING)
		stream.BatchHeader.Fields[events.SrcKey] = schema.NewField(typing.STRING)
		stream.BatchHeader.Fields[timestamp.Key] = schema.NewField(typing.TIMESTAMP)

		for _, object := range stream.Objects {
			//enrich with system fields values
			object[events.SrcKey] = srcSource
			object[timestamp.Key] = timestamp.NowUTC()

			//calculate eventID from key fields or whole object
			var eventID string
			if len(stream.KeyFields) > 0 {
				eventID = uuid.GetKeysHash(object, stream.KeyFields)
			} else {
				eventID = uuid.GetHash(object)
			}

			if err := uniqueIDField.Set(object, eventID); err != nil {
				b, _ := json.Marshal(object)
				return fmt.Errorf("Error setting unique ID field into %s: %v", string(b), err)
			}
		}

		rowsCount := len(stream.Objects)
		//Sync stream
		for _, storage := range rs.destinations {
			if stream.NeedClean {
				err := storage.Clean(stream.BatchHeader.TableName)
				if err != nil {
					logging.Warnf("[%s] storage table %s cleaning failed, ignoring: %v", storage.ID(), stream.BatchHeader.TableName, err)
				}
				stream.NeedClean = false
			}
			err := storage.SyncStore(stream.BatchHeader, stream.Objects, "", false)
			if err != nil {
				errMsg := fmt.Sprintf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.ID(), err)
				metrics.ErrorSourceEvents(rs.task.Source, storage.ID(), rowsCount)
				metrics.ErrorObjects(rs.task.Source, rowsCount)
				telemetry.Error(rs.task.Source, storage.ID(), srcSource, rs.tap, rowsCount)
				counters.ErrorPullDestinationEvents(storage.ID(), rowsCount)
				counters.ErrorPullSourceEvents(rs.task.Source, rowsCount)
				return errors.New(errMsg)
			}

			metrics.SuccessSourceEvents(rs.task.Source, storage.ID(), rowsCount)
			metrics.SuccessObjects(rs.task.Source, rowsCount)
			telemetry.Event(rs.task.Source, storage.ID(), srcSource, rs.tap, rowsCount)
			counters.SuccessPullDestinationEvents(storage.ID(), rowsCount)
		}

		counters.SuccessPullSourceEvents(rs.task.Source, rowsCount)

		rs.taskLogger.INFO("Synchronized successfully Table [%s] key fields [%s] objects [%d]", tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))
	}

	//save state
	if representation.State != nil {
		stateJSON, err := json.Marshal(representation.State)
		if err != nil {
			errMsg := fmt.Sprintf("Error marshalling state in source [%s] tap [%s] signature [%v]: %v", rs.task.Source, rs.tap, representation.State, err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}

		err = rs.metaStorage.SaveSignature(rs.task.Source, rs.collectionMetaKey, driversbase.ALL.String(), string(stateJSON))
		if err != nil {
			errMsg := fmt.Sprintf("Unable to save source [%s] tap [%s] signature [%s]: %v", rs.task.Source, rs.tap, string(stateJSON), err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}

		//Config file might be updated by cli program after successful run.
		//We need to write it to persistent storage so other cluster nodes will read actual config
		configBytes, err := ioutil.ReadFile(rs.configPath)
		if configBytes != nil {
			err = rs.metaStorage.SaveSignature(rs.task.Source, rs.collectionMetaKey + ConfigSignatureSuffix, driversbase.ALL.String(), string(configBytes))
		}
		if err != nil {
			errMsg := fmt.Sprintf("Unable to save source [%s] tap [%s] config: %v", rs.task.Source, rs.tap, err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}
	}

	return nil
}
