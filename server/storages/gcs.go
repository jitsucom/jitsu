package storages

import (
	"context"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/config"
)

func init() {
	RegisterFileStorage(GCSType, NewGoogleCloudStorage, func(config *config.DestinationConfig) map[string]interface{} {
		return config.Google
	})
}

func NewGoogleCloudStorage(config *Config) (Storage, error) {
	if err := requireBatchMode(config); err != nil {
		return nil, err
	}

	var adapterConfig adapters.GoogleConfig
	if err := config.destination.GetDestConfig(config.destination.Google, &adapterConfig); err != nil {
		return nil, err
	}

	adapter, err := adapters.NewGoogleCloudStorage(context.Background(), &adapterConfig)
	if err != nil {
		return nil, err
	}

	fs := &FileStorage{
		storageType: GCSType,
		adapter:     adapter,
	}

	if err := fs.Init(config, fs, "", ""); err != nil {
		_ = fs.Close()
		return nil, err
	}

	return fs, nil
}
