package synchronization

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/singer"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/uuid"
	"strings"
)

type ResultSaver struct {
	task         *meta.Task
	tap          string
	taskLogger   *TaskLogger
	destinations []storages.Storage
	metaStorage  meta.Storage
}

func NewResultSaver(task *meta.Task, tap string, taskLogger *TaskLogger, destinations []storages.Storage, metaStorage meta.Storage) *ResultSaver {
	return &ResultSaver{
		task:         task,
		tap:          tap,
		taskLogger:   taskLogger,
		destinations: destinations,
		metaStorage:  metaStorage,
	}
}

func (rs *ResultSaver) Consume(representation *singer.OutputRepresentation) error {
	for tableName, stream := range representation.Streams {
		rs.taskLogger.INFO("Table [%s] key fields [%s] objects [%d]", tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))

		for _, object := range stream.Objects {
			//enrich with system fields values
			object["src"] = "source"
			object[timestamp.Key] = timestamp.NowUTC()

			//calculate eventId from key fields or whole object
			var eventId string
			if len(stream.KeyFields) > 0 {
				eventId = uuid.GetKeysHash(object, stream.KeyFields)
			} else {
				eventId = uuid.GetHash(object)
			}
			events.EnrichWithEventId(object, eventId)
		}

		//Sync stream
		for _, storage := range rs.destinations {
			rowsCount, err := storage.SyncStore(stream.BatchHeader, stream.Objects, "")
			if err != nil {
				errMsg := fmt.Sprintf("Error storing %d source objects in [%s] destination: %v", rowsCount, storage.Name(), err)
				metrics.ErrorSourceEvents(rs.task.Source, storage.Name(), rowsCount)
				metrics.ErrorObjects(rs.task.Source, rowsCount)
				return errors.New(errMsg)
			}

			metrics.SuccessSourceEvents(rs.task.Source, storage.Name(), rowsCount)
			metrics.SuccessObjects(rs.task.Source, rowsCount)
		}

		rs.taskLogger.INFO("Synchronized successfully Table [%s] key fields [%s] objects [%d]", tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))
	}

	//save state
	if representation.State != nil {
		stateJson, err := json.Marshal(representation.State)
		if err != nil {
			errMsg := fmt.Sprintf("Error marshalling Singer state in source [%s] tap [%s] signature [%v]: %v", rs.task.Source, rs.tap, representation.State, err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}

		err = rs.metaStorage.SaveSignature(rs.task.Source, rs.tap, drivers.ALL.String(), string(stateJson))
		if err != nil {
			errMsg := fmt.Sprintf("Unable to save source [%s] tap [%s] signature [%s]: %v", rs.task.Source, rs.tap, string(stateJson), err)
			logging.SystemError(errMsg)
			return errors.New(errMsg)
		}
	}

	return nil
}
