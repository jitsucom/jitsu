package storages

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/config"
)

func init() {
	RegisterFileStorage(S3Type, NewS3, func(config *config.DestinationConfig) map[string]interface{} {
		return config.S3
	})
}

func NewS3(config *Config) (Storage, error) {
	if err := requireBatchMode(config); err != nil {
		return nil, err
	}

	var adapterConfig adapters.S3Config
	if err := config.destination.GetDestConfig(config.destination.S3, &adapterConfig); err != nil {
		return nil, err
	}

	adapter, err := adapters.NewS3(&adapterConfig)
	if err != nil {
		return nil, err
	}

	fs := &FileStorage{
		storageType: S3Type,
		adapter:     adapter,
	}

	if err := fs.Init(config, fs, "", ""); err != nil {
		_ = fs.Close()
		return nil, err
	}

	return fs, nil
}
