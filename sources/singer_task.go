package sources

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/uuid"
	"strings"
	"time"
)

type SingerTask struct {
	sourceId   string
	collection string
	identifier string

	driver      *drivers.Singer
	metaStorage meta.Storage

	destinations []storages.Storage

	lock storages.Lock
}

func NewSingerTask(sourceId, collection, identifier string, driver *drivers.Singer, metaStorage meta.Storage,
	destinations []storages.Storage, lock storages.Lock) Task {
	return &SingerTask{
		sourceId:     sourceId,
		collection:   collection,
		identifier:   identifier,
		driver:       driver,
		metaStorage:  metaStorage,
		destinations: destinations,
		lock:         lock,
	}
}

func (st *SingerTask) Sync() {
	start := time.Now()
	strWriter := logging.NewStringWriter()
	strLogger := logging.NewSyncLogger(strWriter)

	st.updateCollectionStatus(meta.StatusLoading, "Still Running..")

	status := meta.StatusFailed
	defer func() {
		st.updateCollectionStatus(status, strWriter.String())
	}()

	strLogger.Infof("[%s] Running singer sync task", st.identifier)
	logging.Infof("[%s] Running singer sync task", st.identifier)

	//get singer state
	singerState, err := st.metaStorage.GetSignature(st.sourceId, st.driver.GetTap(), drivers.ALL.String())
	if err != nil {
		strLogger.Errorf("[%s] Error getting state from meta storage: %v", st.identifier, err)
		logging.Errorf("[%s] Error getting state from meta storage: %v", st.identifier, err)
		return
	}

	if singerState != "" {
		strLogger.Infof("[%s] Running synchronization with state: %s", st.identifier, singerState)
	} else {
		strLogger.Infof("[%s] Running synchronization", st.identifier)
	}

	singerParsedOutput, err := st.driver.Load(singerState, strLogger)
	if err != nil {
		strLogger.Errorf("[%s] Error synchronization: %v", st.identifier, err)
		logging.Errorf("[%s] Error synchronization: %v", st.identifier, err)
		return
	}

	for tableName, stream := range singerParsedOutput.Streams {
		strLogger.Infof("[%s] Table [%s] key fields [%s] objects [%d]", st.identifier, tableName, strings.Join(stream.KeyFields, ","), len(stream.Objects))

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
		for _, storage := range st.destinations {
			rowsCount, err := storage.SyncStore(stream.BatchHeader, stream.Objects, "")
			if err != nil {
				strLogger.Errorf("[%s] Error storing %d source objects in [%s] destination: %v", st.identifier, rowsCount, storage.Name(), err)
				logging.Errorf("[%s] Error storing %d source objects in [%s] destination: %v", st.identifier, rowsCount, storage.Name(), err)
				metrics.ErrorSourceEvents(st.sourceId, storage.Name(), rowsCount)
				metrics.ErrorObjects(st.sourceId, rowsCount)
				return
			}

			metrics.SuccessSourceEvents(st.sourceId, storage.Name(), rowsCount)
			metrics.SuccessObjects(st.sourceId, rowsCount)
		}
	}

	stateJson, _ := json.Marshal(singerParsedOutput.State)

	if err := st.metaStorage.SaveSignature(st.sourceId, st.driver.GetTap(), drivers.ALL.String(), string(stateJson)); err != nil {
		logging.SystemErrorf("Unable to save source [%s] tap [%s] signature [%s]: %v", st.sourceId, st.driver.GetTap(), string(stateJson), err)
	}

	strLogger.Infof("[%s] singer source has been synchronized!", st.identifier)

	end := time.Now().Sub(start)
	strLogger.Infof("[%s] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", st.identifier, end.Seconds(), end.Minutes())
	logging.Infof("[%s] type: [%s] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", st.identifier, st.driver.Type(), end.Seconds(), end.Minutes())
	status = meta.StatusOk
}

func (st *SingerTask) GetLock() storages.Lock {
	return st.lock
}

func (st *SingerTask) updateCollectionStatus(status, logs string) {
	if err := st.metaStorage.SaveCollectionStatus(st.sourceId, st.collection, status); err != nil {
		logging.SystemErrorf("Unable to update source [%s] collection: [%s] tap [%s] status in storage: %v", st.sourceId, st.collection, st.driver.GetTap(), err)
	}
	if err := st.metaStorage.SaveCollectionLog(st.sourceId, st.collection, logs); err != nil {
		logging.SystemErrorf("Unable to update source [%s] collection: [%s] tap [%s] log in storage: %v", st.sourceId, st.collection, st.driver.GetTap(), err)
	}
}
