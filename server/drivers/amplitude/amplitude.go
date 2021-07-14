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

	known := collection.Name == AmplitudeEvents ||
		collection.Name == AmplitudeActiveUsers ||
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

	collection := &base.Collection{
		Name:           AmplitudeEvents,
		DaysBackToLoad: 30,
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

	return nil
}

func (a *Amplitude) Close() error {
	return a.adapter.Close()
}

func (a *Amplitude) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	var intervals []*base.TimeInterval

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
	if a.collection.Name == AmplitudeEvents {
		eventsArray, err := a.adapter.GetEvents(interval)
		if err != nil {
			return nil, err
		}

		return eventsArray, nil
	}

	if a.collection.Name == AmplitudeActiveUsers {
		usersArray, err := a.adapter.GetUsers(interval, TypeActiveUsers)
		if err != nil {
			return nil, err
		}

		return usersArray, nil
	}

	if a.collection.Name == AmplitudeNewUsers {
		usersArray, err := a.adapter.GetUsers(interval, TypeNewUsers)
		if err != nil {
			return nil, err
		}

		return usersArray, nil
	}

	return nil, fmt.Errorf("Unknown collection for amplitude: %v", a.collection.Name)
}

func (a *Amplitude) Type() string {
	return base.AmplitudeType
}
