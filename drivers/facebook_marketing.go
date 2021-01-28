package drivers

import (
	"context"
	"errors"
	"fmt"
	fb "github.com/huandu/facebook/v2"
	"github.com/jitsucom/eventnative/logging"
	"strings"
	"time"
)

const (
	fbMarketingType = "facebook_marketing"
)

var keyFields = []string{"account_currency", "account_id", "account_name", "ad_id", "ad_name",
	"adset_id", "adset_name", "campaign_id", "campaign_name", "objective", "buying_type",
}

var metrics = []string{"cpc", "cpm", "cpp", "ctr", "estimated_ad_recall_rate", "estimated_ad_recallers", "reach",
	"unique_clicks", "unique_ctr", "frequency", "actions", "conversions"}

type FacebookMarketingConfig struct {
	AccountId string `mapstructure:"account_id" json:"account_id,omitempty" yaml:"account_id,omitempty"`
	Token     string `mapstructure:"token" json:"token,omitempty" yaml:"token,omitempty"`
}

type FacebookMarketing struct {
	collection *Collection
	config     *FacebookMarketingConfig
}

func (fmc *FacebookMarketingConfig) Validate() error {
	if fmc.AccountId == "" {
		return errors.New("[ad_account_id] is not configured")
	}
	if fmc.Token == "" {
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

type FacebookInsightsResponse struct {
	Data []map[string]interface{} `facebook:"data"`
}

func (fm *FacebookMarketing) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	var fields []string
	fields = append(fields, keyFields...)
	fields = append(fields, metrics...)
	res, err := fb.Get("/v9.0/act_"+fm.config.AccountId+"/insights", fb.Params{
		"level":        "ad",
		"fields":       strings.Join(fields, ","),
		"access_token": fm.config.Token,
		"time_range":   fm.buildTimeInterval(interval),
	})
	if err != nil {
		return nil, err
	}
	var response FacebookInsightsResponse
	if err = res.Decode(&response); err != nil {
		return nil, err
	}
	logging.Debugf("[%s] Rows to sync: %d", interval.String(), len(response.Data))
	return response.Data, nil
}

func (fm *FacebookMarketing) buildTimeInterval(interval *TimeInterval) string {
	dayStart := interval.LowerEndpoint()
	since := DAY.Format(dayStart)
	until := DAY.Format(dayStart.AddDate(0, 0, 1))
	return fmt.Sprintf("{'since': '%s', 'until': '%s'}", since, until)
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
