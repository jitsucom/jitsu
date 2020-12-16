package sources

import (
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/uuid"
	"time"
)

type SyncTask struct {
	sourceId   string
	collection string

	identifier string

	driver      drivers.Driver
	metaStorage meta.Storage

	destinations []events.Storage

	lock storages.Lock
}

func (st *SyncTask) Sync() {
	start := time.Now()
	strWriter := logging.NewStringWriter()
	strLogger := logging.NewSyncLogger(strWriter)
	now := time.Now().UTC()

	st.updateCollectionStatus(meta.StatusLoading, "Still Running..")

	status := meta.StatusFailed
	defer st.updateCollectionStatus(status, strWriter.String())

	logging.Infof("[%s] Running sync task type: [%s]", st.identifier, st.driver.Type())
	strLogger.Infof("[%s] Running sync task type: [%s]", st.identifier, st.driver.Type())
	intervals, err := st.driver.GetAllAvailableIntervals()
	if err != nil {
		strLogger.Errorf("[%s] Error getting all available intervals: %v", st.identifier, err)
		logging.Errorf("[%s] Error getting all available intervals: %v", st.identifier, err)
		return
	}

	strLogger.Infof("[%s] Total intervals: [%d]", st.identifier, len(intervals))

	var intervalsToSync []*drivers.TimeInterval
	for _, interval := range intervals {
		storedSignature, err := st.metaStorage.GetSignature(st.sourceId, st.getCollectionMetaKey(), interval.String())
		if err != nil {
			strLogger.Errorf("[%s] Error getting interval [%s] signature: %v", st.identifier, interval.String(), err)
			logging.Errorf("[%s] Error getting interval [%s] signature: %v", st.identifier, interval.String(), err)
			return
		}

		nowSignature := interval.CalculateSignatureFrom(now)

		//just for logs
		var status string
		if storedSignature == "" {
			status = "NEW"
			intervalsToSync = append(intervalsToSync, interval)
		} else if storedSignature != nowSignature || interval.IsAll() {
			status = "REFRESH"
			intervalsToSync = append(intervalsToSync, interval)
		} else {
			status = "UPTODATE"
		}

		strLogger.Infof("[%s] Interval [%s] %s", st.identifier, interval.String(), status)
	}

	logging.Infof("[%s] Intervals to sync: [%d]", st.identifier, len(intervalsToSync))
	strLogger.Infof("[%s] Intervals to sync: [%d]", st.identifier, len(intervalsToSync))

	collectionTable := st.driver.GetCollectionTable()
	for _, intervalToSync := range intervalsToSync {
		strLogger.Infof("[%s] Running [%s] synchronization", st.identifier, intervalToSync.String())

		objects, err := st.driver.GetObjectsFor(intervalToSync)
		if err != nil {
			strLogger.Errorf("[%s] Error [%s] synchronization: %v", st.identifier, intervalToSync.String(), err)
			logging.Errorf("[%s] Error [%s] synchronization: %v", st.identifier, intervalToSync.String(), err)
			return
		}

		for _, object := range objects {
			//enrich with values
			object["src"] = "source"
			object[timestamp.Key] = timestamp.NowUTC()
			events.EnrichWithEventId(object, uuid.GetHash(object))
			events.EnrichWithCollection(object, st.collection)
			events.EnrichWithTimeInterval(object, intervalToSync)
		}

		for _, storage := range st.destinations {
			rowsCount, err := storage.SyncStore(collectionTable, objects)
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

		if err := st.metaStorage.SaveSignature(st.sourceId, st.getCollectionMetaKey(), intervalToSync.String(), intervalToSync.CalculateSignatureFrom(now)); err != nil {
			logging.SystemErrorf("Unable to save source [%s] collection [%s] signature: %v", st.sourceId, st.collection, err)
		}

		strLogger.Infof("[%s] Interval [%s] has been synchronized!", st.identifier, intervalToSync.String())
	}

	end := time.Now().Sub(start)
	strLogger.Infof("[%s] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", st.identifier, end.Seconds(), end.Minutes())
	logging.Infof("[%s] type: [%s] intervals: [%d] FINISHED SUCCESSFULLY in [%.2f] seconds (~ %.2f minutes)", st.identifier, st.driver.Type(), len(intervalsToSync), end.Seconds(), end.Minutes())
	status = meta.StatusOk
}

func (st *SyncTask) getCollectionMetaKey() string {
	return st.collection + "_" + st.driver.GetCollectionTable().Name
}

func (st *SyncTask) updateCollectionStatus(status, logs string) {
	if err := st.metaStorage.SaveCollectionStatus(st.sourceId, st.collection, status); err != nil {
		logging.SystemErrorf("Unable to update source [%s] collection [%s] status in storage: %v", st.sourceId, st.collection, err)
	}
	if err := st.metaStorage.SaveCollectionLog(st.sourceId, st.collection, logs); err != nil {
		logging.SystemErrorf("Unable to update source [%s] collection [%s] log in storage: %v", st.sourceId, st.collection, err)
	}
}
