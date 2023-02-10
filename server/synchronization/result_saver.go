package synchronization

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/counters"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/joomcode/errorx"
	"github.com/spf13/viper"
	"strings"
	"time"
)

// ResultSaver is a Singer/Airbyte result consumer
// tap is a Singer tap or Airbyte source docker image
type ResultSaver struct {
	task              *meta.Task
	tap               string
	collectionMetaKey string
	tableNamePrefix   string
	taskLogger        *TaskLogger
	destinations      []storages.Storage
	metaStorage       meta.Storage
	//mapping stream name -> table name
	streamTableNames map[string]string
	configPath       string
}

// NewResultSaver returns configured ResultSaver instance
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

// Consume consumes result batch and writes it to destinations and saves the State
func (rs *ResultSaver) Consume(representation *driversbase.CLIOutputRepresentation) error {
	for _, stream := range representation.GetStreams() {
		streamName := stream.StreamName
		tableName := rs.generateTableName(utils.NvlString(stream.IntermediateTableName, streamName))
		targetTableName := rs.generateTableName(streamName)
		if targetTableName != tableName && stream.ChunkNumber == 0 {
			rs.taskLogger.INFO("Stream [%s] Is using intermediate temporary table [%s] final table is: [%s]", streamName, tableName, targetTableName)
		}
		stream.BatchHeader.TableName = tableName

		if stream.NeedClean {
			for _, storage := range rs.destinations {
				rs.taskLogger.INFO("Stream [%s] Clearing table [%s] in storage [%s] before adding new data", streamName, tableName, storage.ID())
				err := storage.Clean(stream.BatchHeader.TableName)
				if err != nil {
					if strings.Contains(err.Error(), adapters.ErrTableNotExist.Error()) {
						rs.taskLogger.INFO("Stream [%s] Table [%s] doesn't exist in storage [%s]", streamName, tableName, storage.ID())
					} else {
						return fmt.Errorf("[%s] storage table %s cleaning failed: %v", storage.ID(), tableName, err)
					}
				}
			}
			stream.NeedClean = false
		}

		//airbyte can have empty objects
		if len(stream.Objects) == 0 {
			continue
		}
		//Note: we assume that destinations connected to 1 source can't have different unique ID configuration
		uniqueIDField := rs.destinations[0].GetUniqueIDField()
		stream.BatchHeader.Fields[uniqueIDField.GetFlatFieldName()] = schema.NewField(typing.STRING)
		stream.BatchHeader.Fields[events.SrcKey] = schema.NewField(typing.STRING)
		stream.BatchHeader.Fields[events.SourceIDKey] = schema.NewField(typing.STRING)
		stream.BatchHeader.Fields[timestamp.Key] = schema.NewField(typing.TIMESTAMP)

		keyFields := stream.KeyFields
		if len(keyFields) == 0 && rs.tap == "source-mongodb-v2" {
			//workaround for mongodb airbyte source that don't return key fields
			keyFields = []string{"_id"}
			stream.KeepKeysUnhashed = true
		}
		for _, object := range stream.Objects {
			//enrich with system fields values
			object[events.SrcKey] = srcSource
			if _, ok := object[timestamp.Key]; !ok {
				object[timestamp.Key] = timestamp.NowUTC()
			}
			events.EnrichWithSourceId(object, rs.task.Source)

			//calculate eventID from key fields or whole object
			var eventID string
			if len(keyFields) > 0 {
				if stream.KeepKeysUnhashed {
					eventID = uuid.GetKeysUnhashed(object, keyFields)
				} else {
					eventID = uuid.GetKeysHash(object, keyFields)
				}
			} else {
				eventID = uuid.GetHash(object)
			}

			if err := uniqueIDField.Set(object, eventID); err != nil {
				b, _ := json.Marshal(object)
				return fmt.Errorf("Error setting unique ID field into %s: %v", string(b), err)
			}
			if stream.RemoveSourceKeyFields {
				for _, kf := range keyFields {
					delete(object, kf)
				}
			}
		}

		storeAttempts := viper.GetInt("sync-tasks.store_attempts")
		needCopyEvent := len(rs.destinations) > 1 || storeAttempts > 1
		rowsCount := len(stream.Objects)
		//Sync stream
		for _, storage := range rs.destinations {
			batchStart := timestamp.Now()
			var err error
			for i := 0; i < storeAttempts; i++ {
				rs.taskLogger.INFO("Stream [%s] Flushing batch - adding %d objects to [%s]. Key fields=[%s] Storage=[%s] Attempt: %d of %d", streamName, rowsCount, tableName, strings.Join(keyFields, ","), storage.ID(), i+1, storeAttempts)
				err = storage.SyncStore(stream.BatchHeader, stream.Objects, stream.DeleteConditions, false, needCopyEvent)
				if err == nil {
					break
				} else if i < storeAttempts-1 {
					rs.taskLogger.ERROR("Stream [%s] Error storing %d source objects in [%s] destination (%d attempts left): %v", streamName, rowsCount, storage.ID(), storeAttempts-i-1, err)
				}
			}
			batchLoadTime := timestamp.Now().Sub(batchStart)
			var replaceTableTime time.Duration
			if err == nil {
				rs.taskLogger.INFO("Stream [%s] %d objects stored to [%s]. Columns count: %d. Time: %s, Rows/sec: %.2f. Storage=[%s]", streamName, rowsCount, tableName, len(stream.Objects[0]), batchLoadTime.Round(time.Millisecond), float64(rowsCount)/batchLoadTime.Seconds(), storage.ID())
				if stream.SwapWithIntermediateTable && targetTableName != tableName {
					replaceStart := timestamp.Now()
					rs.taskLogger.INFO("Stream [%s] Replacing final table: [%s] with content of: [%s]", streamName, targetTableName, tableName)
					err = storage.ReplaceTable(targetTableName, tableName, true)
					if errorx.IsOfType(err, errorj.DropError) {
						err = storage.ReplaceTable(targetTableName, tableName, false)
					}
					replaceTableTime = timestamp.Now().Sub(replaceStart)
					rs.taskLogger.INFO("Stream [%s] Replace table time: %s", streamName, replaceTableTime.String())
				}
			}
			if err != nil {
				errMsg := fmt.Sprintf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.ID(), err)
				metrics.ErrorSourceEvents(rs.task.SourceType, rs.tap, rs.task.Source, storage.Type(), storage.ID(), rowsCount)
				metrics.ErrorObjects(rs.task.SourceType, rs.tap, rs.task.Source, rowsCount)
				telemetry.Error(rs.task.Source, storage.ID(), srcSource, rs.tap, rowsCount)
				counters.ErrorPullDestinationEvents(storage.ID(), int64(rowsCount))
				counters.ErrorPullSourceEvents(rs.task.Source, int64(rowsCount))
				return errors.New(errMsg)
			}

			metrics.SuccessSourceEvents(rs.task.SourceType, rs.tap, rs.task.Source, storage.Type(), storage.ID(), rowsCount)
			metrics.SuccessObjects(rs.task.SourceType, rs.tap, rs.task.Source, rowsCount)
			telemetry.Event(rs.task.Source, storage.ID(), srcSource, rs.tap, rowsCount)
			counters.SuccessPullDestinationEvents(storage.ID(), int64(rowsCount))
		}

		counters.SuccessPullSourceEvents(rs.task.Source, int64(rowsCount))
	}

	//save state
	if representation.State != nil {
		stateJSON, err := json.Marshal(representation.State)
		if err != nil {
			errMsg := fmt.Sprintf("Error marshalling state in source [%s] tap [%s] signature [%v]: %v", rs.task.Source, rs.tap, representation.State, err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}
		rs.taskLogger.INFO("Saving state: %s", string(stateJSON))
		err = rs.metaStorage.SaveSignature(rs.task.Source, rs.collectionMetaKey, schema.ALL.String(), string(stateJSON))
		if err != nil {
			errMsg := fmt.Sprintf("Unable to save source [%s] tap [%s] signature [%s]: %v", rs.task.Source, rs.tap, string(stateJSON), err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}
	}

	return nil
}

// CleanupAfterError do cleanup if necessary. Like deleting temporary tables after errors
func (rs *ResultSaver) CleanupAfterError(representation *driversbase.CLIOutputRepresentation) {
	if representation == nil {
		return
	}
	for _, stream := range representation.GetStreams() {
		streamName := stream.StreamName
		//Only if current stream  has intermediate table - delete it
		if stream.IntermediateTableName != "" {
			tableName := rs.generateTableName(stream.IntermediateTableName)
			for _, storage := range rs.destinations {
				rs.taskLogger.INFO("Stream [%s] Deleting intermediate table [%s] in storage [%s]", streamName, tableName, storage.ID())
				_ = storage.DropTable(tableName)
			}
		}
	}
}

func (rs *ResultSaver) generateTableName(streamName string) string {
	tableName, ok := rs.streamTableNames[streamName]
	if !ok {
		tableName = rs.tableNamePrefix + streamName
	}
	return schema.Reformat(tableName)
}

func (rs *ResultSaver) Tap() string {
	return rs.tap
}
