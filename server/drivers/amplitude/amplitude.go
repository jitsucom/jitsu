package amplitude

import (
	"context"
	"fmt"
	"time"

	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/storages"
)

// Amplitude is a Amplitude driver.
// It is used in syncing data from Amplitude.
type Amplitude struct {
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
	if err := base.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	known := collection.Name == AmplitudeActiveUsers ||
		collection.Name == AmplitudeAnnotations ||
		collection.Name == AmplitudeAverageSessions ||
		collection.Name == AmplitudeCohorts ||
		collection.Name == AmplitudeEvents ||
		collection.Name == AmplitudeNewUsers

	if !known {
		return nil, fmt.Errorf("Unknown collection for amplitude: %v", collection.Name)
	}

	adapter, err := NewAmplitudeAdapter(config.ApiKey, config.SecretKey, storages.DefaultHTTPConfiguration)
	if err != nil {
		return nil, err
	}

	if err = adapter.GetStatus(); err != nil {
		return nil, err
	}

	return &Amplitude{
		adapter:    adapter,
		config:     config,
		collection: collection,
	}, nil
}

// TestAmplitude tests connection to Amplitude without creating Driver instance
func TestAmplitude(sourceConfig *base.SourceConfig) error {
	config := &AmplitudeConfig{}
	if err := base.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}

	if err := config.Validate(); err != nil {
		return err
	}

	adapter, err := NewAmplitudeAdapter(config.ApiKey, config.SecretKey, storages.DefaultHTTPConfiguration)
	if err != nil {
		return err
	}
	defer adapter.Close()

	if err = adapter.GetStatus(); err != nil {
		return err
	}

	collectionNames := []string{
		AmplitudeActiveUsers,
		AmplitudeAnnotations,
		AmplitudeAverageSessions,
		AmplitudeCohorts,
		AmplitudeEvents,
		AmplitudeNewUsers,
	}

	for _, name := range collectionNames {
		collection := &base.Collection{
			Name:           name,
			DaysBackToLoad: 10,
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

		for _, interval := range intervals {
			if _, err := amplitude.GetObjectsFor(interval); err != nil {
				return err
			}
		}
	}

	return nil
}

func (a *Amplitude) Close() error {
	return a.adapter.Close()
}

func (a *Amplitude) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	var intervals []*base.TimeInterval

	if a.collection.Name == AmplitudeAnnotations || a.collection.Name == AmplitudeCohorts {
		intervals = append(intervals, base.NewTimeInterval(base.ALL, time.Time{}))
		return intervals, nil
	}

	daysBackToLoad := base.DefaultDaysBackToLoad
	if a.collection.DaysBackToLoad > 0 {
		daysBackToLoad = a.collection.DaysBackToLoad
	}

	now := time.Now().UTC()
	for i := 0; i < daysBackToLoad; i++ {
		date := now.AddDate(0, 0, -i)
		intervals = append(intervals, base.NewTimeInterval(base.DAY, date))
	}

	return intervals, nil
}

func (a *Amplitude) GetCollectionMetaKey() string {
	return a.collection.Name + "_" + a.GetCollectionTable()
}

func (a *Amplitude) GetCollectionTable() string {
	return a.collection.GetTableName()
}

func (a *Amplitude) GetObjectsFor(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	var err error
	var array []map[string]interface{}

	switch a.collection.Name {
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
		err = fmt.Errorf("Unknown collection for amplitude: %v", a.collection.Name)
	}

	if err != nil {
		return nil, err
	}

	return array, nil
}

func (a *Amplitude) Type() string {
	return base.AmplitudeType
}
