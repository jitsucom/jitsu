package drivers

import (
	"context"
	"errors"
	"github.com/jitsucom/eventnative/logging"
	"time"
)

const fbMarketingType = "facebook_marketing"

type FacebookMarketingConfig struct {
	adAccountId string
	token       string
}

type FacebookMarketing struct {
	collection *Collection
	config     *FacebookMarketingConfig
}

func (fmc *FacebookMarketingConfig) Validate() error {
	if fmc.adAccountId == "" {
		return errors.New("[ad_account_id] is not configured")
	}
	if fmc.token == "" {
		return errors.New("[token] is not configured")
	}
	return nil
}

func NewFacebookMarketing(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &FacebookMarketingConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}
	return &FacebookMarketing{collection: collection, config: config}, nil
}

func init() {
	if err := RegisterDriverConstructor(fbMarketingType, NewFacebookMarketing); err != nil {
		logging.Errorf("Failed to register driver %s: %v", fbMarketingType, err)
	}
}

func (fm *FacebookMarketing) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	var intervals []*TimeInterval
	now := time.Now().UTC()
	for i := 0; i < 365; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, NewTimeInterval(DAY, date))
	}
	return intervals, nil
}

func (fm *FacebookMarketing) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	panic("implement me")
}

func (fm *FacebookMarketing) Type() string {
	return fbMarketingType
}

func (fm *FacebookMarketing) GetCollectionTable() string {
	return fm.collection.GetTableName()
}

func (fm *FacebookMarketing) Close() error {
	panic("implement me")
}
