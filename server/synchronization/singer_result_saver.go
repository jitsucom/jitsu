package synchronization

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"strings"
)

//ResultSaver is a Singer result consumer
type ResultSaver struct {
	task         *meta.Task
	tap          string
	taskLogger   *TaskLogger
	destinations []storages.Storage
	metaStorage  meta.Storage
}

//NewResultSaver returns configured Singer ResultSaver instance
func NewResultSaver(task *meta.Task, tap string, taskLogger *TaskLogger, destinations []storages.Storage, metaStorage meta.Storage) *ResultSaver {
	return &ResultSaver{
		task:         task,
		tap:          tap,
		taskLogger:   taskLogger,
		destinations: destinations,
		metaStorage:  metaStorage,
	}
}

//Consume consumes result batch and writes it to destinations and saves Singer State
func (rs *ResultSaver) Consume(representation *singer.OutputRepresentation) error {
	for tableName, stream := range representation.Streams {
		rs.taskLogger.INFO("Table [%s] key fields [%s] objects [%d]", tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))

		//Note: we assume that destinations connected to 1 source can't have different unique ID configuration
		uniqueIDField := rs.destinations[0].GetUniqueIDField()

		for _, object := range stream.Objects {
			//enrich with system fields values
			object["src"] = srcSource
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
			err := storage.SyncStore(stream.BatchHeader, stream.Objects, "")
			if err != nil {
				errMsg := fmt.Sprintf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.ID(), err)
				metrics.ErrorSourceEvents(rs.task.Source, storage.ID(), rowsCount)
				metrics.ErrorObjects(rs.task.Source, rowsCount)
				telemetry.Error(rs.task.Source, storage.ID(), srcSource, rowsCount)
				return errors.New(errMsg)
			}

			metrics.SuccessSourceEvents(rs.task.Source, storage.ID(), rowsCount)
			metrics.SuccessObjects(rs.task.Source, rowsCount)
			telemetry.Event(rs.task.Source, storage.ID(), srcSource, rowsCount)
		}

		counters.SuccessSourceEvents(rs.task.Source, len(stream.Objects))

		rs.taskLogger.INFO("Synchronized successfully Table [%s] key fields [%s] objects [%d]", tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))
	}

	//save state
	if representation.State != nil {
		stateJSON, err := json.Marshal(representation.State)
		if err != nil {
			errMsg := fmt.Sprintf("Error marshalling Singer state in source [%s] tap [%s] signature [%v]: %v", rs.task.Source, rs.tap, representation.State, err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}

		err = rs.metaStorage.SaveSignature(rs.task.Source, rs.tap, drivers.ALL.String(), string(stateJSON))
		if err != nil {
			errMsg := fmt.Sprintf("Unable to save source [%s] tap [%s] signature [%s]: %v", rs.task.Source, rs.tap, string(stateJSON), err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}
	}

	return nil
}
