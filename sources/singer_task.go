package sources

import (
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/storages"
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

	rs := NewResultSaver(st.identifier, st.sourceId, st.driver.GetTap(), strLogger, st.destinations, st.metaStorage)

	err = st.driver.Load(singerState, strLogger, rs)
	if err != nil {
		strLogger.Errorf("[%s] Error synchronization: %v", st.identifier, err)
		logging.Errorf("[%s] Error synchronization: %v", st.identifier, err)
		return
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
