package app

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"io"
	"sync/atomic"
	"time"
)

type Destinations struct {
	DestinationsList []*DestinationConfig
	Destinations     map[string]*DestinationConfig
	LastModified     time.Time
}

func (d *Destinations) GetDestinationConfigs() []*DestinationConfig {
	return d.DestinationsList
}

func (d *Destinations) GetDestinationConfig(id string) *DestinationConfig {
	return d.Destinations[id]
}

type DestinationsRepositoryData struct {
	data atomic.Pointer[Destinations]
}

func (drd *DestinationsRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	// read open bracket
	_, err := dec.Token()
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}
	destinations := make([]*DestinationConfig, 0)
	destinationsMap := map[string]*DestinationConfig{}
	// while the array contains values
	for dec.More() {
		dc := DestinationConfig{}
		err = dec.Decode(&dc)
		if err != nil {
			return fmt.Errorf("Error unmarshalling destination config: %v", err)
		}
		destinations = append(destinations, &dc)
		destinationsMap[dc.Id()] = &dc
	}

	// read closing bracket
	_, err = dec.Token()
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := Destinations{
		Destinations:     destinationsMap,
		DestinationsList: destinations,
	}
	if tag != nil {
		data.LastModified = tag.(time.Time)
	}
	drd.data.Store(&data)
	return nil
}

func (drd *DestinationsRepositoryData) GetData() *Destinations {
	return drd.data.Load()
}

func (drd *DestinationsRepositoryData) Store(writer io.Writer) error {
	d := drd.data.Load()
	if d != nil {
		encoder := json.NewEncoder(writer)
		err := encoder.Encode(d.DestinationsList)
		return err
	}
	return nil
}

type HTTPConfigurationSource struct {
	appbase.Repository[Destinations]
}

func NewHTTPConfigurationSource(appconfig *Config) *HTTPConfigurationSource {
	rep := appbase.NewHTTPRepository[Destinations]("bulker-connections", appconfig.ConfigSource, appconfig.ConfigSourceHTTPAuthToken, appbase.HTTPTagLastModified, &DestinationsRepositoryData{}, 1, appconfig.ConfigRefreshPeriodSec, appconfig.CacheDir, appbase.ExitOnNoData)
	return &HTTPConfigurationSource{rep}
}

func (h *HTTPConfigurationSource) GetDestinationConfigs() []*DestinationConfig {
	return h.GetData().GetDestinationConfigs()
}

func (h *HTTPConfigurationSource) GetDestinationConfig(id string) *DestinationConfig {
	return h.GetData().GetDestinationConfig(id)
}
