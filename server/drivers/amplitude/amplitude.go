package amplitude

import (
	"context"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"

	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/storages"
)

//amplitudeHTTPConfiguration contains default amplitude HTTP timeouts/retry/delays,etc
var amplitudeHTTPConfiguration = &adapters.HTTPConfiguration{
	GlobalClientTimeout:       10 * time.Minute,
	RetryDelay:                10 * time.Second,
	RetryCount:                5,
	ClientMaxIdleConns:        1000,
	ClientMaxIdleConnsPerHost: 1000,
}

// Amplitude is an Amplitude driver.
// It is used in syncing data from Amplitude.
type Amplitude struct {
	base.IntervalDriver

	adapter    *AmplitudeAdapter
	config     *AmplitudeConfig
	collection *base.Collection
}

func init() {
	base.RegisterDriver(base.AmplitudeType, NewAmplitude)
	base.RegisterTestConnectionFunc(base.AmplitudeType, TestAmplitude)
}

// NewAmplitude returns configured Amplitude driver instance
func NewAmplitude(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &AmplitudeConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	known := collection.Type == AmplitudeActiveUsers ||
		collection.Type == AmplitudeAnnotations ||
		collection.Type == AmplitudeAverageSessions ||
		collection.Type == AmplitudeCohorts ||
		collection.Type == AmplitudeEvents ||
		collection.Type == AmplitudeNewUsers

	if !known {
		return nil, fmt.Errorf("Unknown collection for amplitude: %v", collection.Type)
	}

	adapter, err := NewAmplitudeAdapter(config.ApiKey, config.SecretKey, config.Server, amplitudeHTTPConfiguration)
	if err != nil {
		return nil, err
	}

	if err = adapter.GetStatus(); err != nil {
		return nil, err
	}

	return &Amplitude{
		IntervalDriver: base.IntervalDriver{SourceType: sourceConfig.Type},
		adapter:        adapter,
		config:         config,
		collection:     collection,
	}, nil
}

// TestAmplitude tests connection to Amplitude without creating Driver instance
func TestAmplitude(sourceConfig *base.SourceConfig) error {
	config := &AmplitudeConfig{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}

	if err := config.Validate(); err != nil {
		return err
	}

	adapter, err := NewAmplitudeAdapter(config.ApiKey, config.SecretKey, config.Server, storages.DefaultHTTPConfiguration)
	if err != nil {
		return err
	}
	defer adapter.Close()

	if err = adapter.GetStatus(); err != nil {
		return err
	}

	collection := &base.Collection{
		Name:           AmplitudeEvents,
		Type:           AmplitudeEvents,
		DaysBackToLoad: 1,
	}

	amplitude := &Amplitude{
		adapter:    adapter,
		config:     config,
		collection: collection,
	}

	intervals, err := amplitude.GetAllAvailableIntervals()
	if err != nil {
		return err
	}

	dummyLoader := func(o []map[string]interface{}, pos int, total int, percent int) error {
		return nil
	}
	for _, interval := range intervals {
		if err := amplitude.GetObjectsFor(interval, dummyLoader); err != nil {
			return err
		}
	}

	return nil
}

func (a *Amplitude) Close() error {
	return a.adapter.Close()
}

func (a *Amplitude) GetRefreshWindow() (time.Duration, error) {
	return time.Hour * 24, nil
}

func (a *Amplitude) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	var intervals []*base.TimeInterval

	if a.collection.Type == AmplitudeAnnotations || a.collection.Type == AmplitudeCohorts {
		intervals = append(intervals, base.NewTimeInterval(schema.ALL, time.Time{}))
		return intervals, nil
	}

	daysBackToLoad := base.DefaultDaysBackToLoad
	if a.collection.DaysBackToLoad > 0 {
		daysBackToLoad = a.collection.DaysBackToLoad
	}

	now := timestamp.Now().UTC()
	for i := 0; i < daysBackToLoad; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, base.NewTimeInterval(schema.DAY, date))
	}

	return intervals, nil
}

func (a *Amplitude) GetCollectionMetaKey() string {
	return a.collection.Name + "_" + a.GetCollectionTable()
}

func (a *Amplitude) GetCollectionTable() string {
	return a.collection.GetTableName()
}

func (a *Amplitude) GetObjectsFor(interval *base.TimeInterval, objectsLoader base.ObjectsLoader) error {
	var err error
	var array []map[string]interface{}

	switch a.collection.Type {
	case AmplitudeActiveUsers:
		array, err = a.adapter.GetUsers(interval, AmplitudeActiveUsers)
	case AmplitudeAnnotations:
		array, err = a.adapter.GetAnnotations()
	case AmplitudeAverageSessions:
		array, err = a.adapter.GetSessions(interval)
	case AmplitudeCohorts:
		array, err = a.adapter.GetCohorts()
	case AmplitudeEvents:
		array, err = a.adapter.GetEvents(interval)
	case AmplitudeNewUsers:
		array, err = a.adapter.GetUsers(interval, AmplitudeNewUsers)
	default:
		err = fmt.Errorf("Unknown collection for amplitude: %v", a.collection.Type)
	}

	if err != nil {
		return err
	}

	return objectsLoader(array, 0, len(array), 0)
}

func (a *Amplitude) Type() string {
	return base.AmplitudeType
}
