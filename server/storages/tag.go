package storages

import (
	"errors"
	"github.com/jitsucom/jitsu/server/adapters"
	enconfig "github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/utils"
)

type TagDestination struct {
	Abstract
	adapter    *adapters.Tag
	syncWorker *SyncWorker
}

func init() {
	RegisterStorage(StorageType{typeName: TagType, createFunc: NewTagDestination, isSQL: false, IsSynchronous: true})
}

//NewTagDestination returns configured TagDestination
func NewTagDestination(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()

	tagConfig := &adapters.TagConfig{}
	if err = config.destination.GetDestConfig(map[string]interface{}{}, tagConfig); err != nil {
		return nil, err
	}
	if config.destination.DataLayout == nil {
		config.destination.DataLayout = &enconfig.DataLayout{}
	}
	config.destination.DataLayout.TableNameTemplate = utils.NvlString(tagConfig.Filter, "always")
	tag := &TagDestination{}
	err = tag.Init(config, tag, "", "")
	if err != nil {
		return
	}
	storage = tag

	tagAdapter, err := adapters.NewTag(tagConfig, config.destinationID)
	if err != nil {
		return
	}

	tag.syncWorker = newSyncWorker(tag)

	tag.adapter = tagAdapter
	return
}

func (t *TagDestination) ProcessEvent(eventContext *adapters.EventContext) (map[string]interface{}, error) {
	res, err := t.adapter.ProcessEvent(eventContext.ProcessedEvent)
	if err != nil {
		return nil, err
	}
	eventContext.SynchronousResult = res
	return res, nil
}

//Type returns NpmType type
func (t *TagDestination) Type() string {
	return TagType
}

func (t *TagDestination) Close() error {
	if t.adapter != nil {
		return t.adapter.Close()
	}
	return nil
}

func (t *TagDestination) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *base.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	return errors.New("TagDestination doesn't support sync store")
}

func (t *TagDestination) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

func (t *TagDestination) GetSyncWorker() *SyncWorker {
	return t.syncWorker
}
