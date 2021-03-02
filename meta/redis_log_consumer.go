package meta

import "github.com/jitsucom/eventnative/logging"

type RedisLogConsumer struct {
	sourceId   string
	collection string

	metaStorage Storage
}

func NewRedisLogConsumer(sourceId, collection string, storage Storage) *RedisLogConsumer {
	return &RedisLogConsumer{sourceId: sourceId, collection: collection, metaStorage: storage}
}

func (rlc *RedisLogConsumer) Consume(msg string) {
	if err := rlc.metaStorage.SaveCollectionLog(rlc.sourceId, rlc.collection, msg); err != nil {
		logging.SystemErrorf("Unable to update source [%s] collection [%s] log in storage: %v", rlc.sourceId, rlc.collection, err)
	}
}
