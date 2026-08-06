package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

// Streams repository types (same as admin/repository.go)
type Streams struct {
	streams                []*StreamWithDestinations
	streamsByPlainKeyOrIds map[string]*StreamWithDestinations
	lastModified           time.Time
}

func (s *Streams) GetStreamByPlainKeyOrId(plainKeyOrSlug string) *StreamWithDestinations {
	return s.streamsByPlainKeyOrIds[plainKeyOrSlug]
}

func (s *Streams) GetStreams() []*StreamWithDestinations {
	return s.streams
}

type StreamsRepositoryData struct {
	data atomic.Pointer[Streams]
}

func (s *StreamsRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	// read open bracket
	_, err := dec.Token()
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}
	streams := make([]*StreamWithDestinations, 0)
	streamsByPlainKeyOrIds := map[string]*StreamWithDestinations{}

	// while the array contains values
	for dec.More() {
		swd := StreamWithDestinations{}
		err = dec.Decode(&swd)
		if err != nil {
			return fmt.Errorf("Error unmarshalling stream config: %v", err)
		}
		swd.init()
		streams = append(streams, &swd)
		streamsByPlainKeyOrIds[swd.Stream.Id] = &swd
	}

	// read closing bracket
	_, err = dec.Token()
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := Streams{
		streams:                streams,
		streamsByPlainKeyOrIds: streamsByPlainKeyOrIds,
	}
	if tag != nil {
		data.lastModified = tag.(time.Time)
	}
	s.data.Store(&data)
	return nil
}

func (s *StreamsRepositoryData) GetData() *Streams {
	return s.data.Load()
}

func (s *StreamsRepositoryData) Store(writer io.Writer) error {
	d := s.data.Load()
	if d != nil {
		encoder := json.NewEncoder(writer)
		err := encoder.Encode(d.streams)
		return err
	}
	return nil
}

func NewStreamsRepository(url, token string, refreshPeriodSec int, cacheDir string) appbase.Repository[Streams] {
	return appbase.NewHTTPRepository[Streams]("streams-with-destinations", url, token, appbase.HTTPTagLastModified, &StreamsRepositoryData{}, 1, refreshPeriodSec, cacheDir, appbase.ExitOnNoData)
}

type StreamConfig struct {
	Id          string `json:"id"`
	WorkspaceId string `json:"workspaceId"`
	Name        string `json:"name"`
}

type ShortDestinationConfig struct {
	Id              string         `json:"id"`
	ConnectionId    string         `json:"connectionId,omitempty"`
	DestinationType string         `json:"destinationType"`
	Options         map[string]any `json:"options,omitempty"`
}

type StreamWithDestinations struct {
	Stream                   StreamConfig             `json:"stream"`
	UpdateAt                 time.Time                `json:"updatedAt"`
	Destinations             []ShortDestinationConfig `json:"destinations"`
	AsynchronousDestinations []ShortDestinationConfig
}

func (s *StreamWithDestinations) init() {
	// Initialize asynchronous destinations from destinations
	s.AsynchronousDestinations = make([]ShortDestinationConfig, 0)
	for _, d := range s.Destinations {
		if d.Id != "" && d.DestinationType != "" {
			s.AsynchronousDestinations = append(s.AsynchronousDestinations, d)
		}
	}
}

// fetchStreamsData fetches streams data from repository once (no refresh needed for short-lived workers)
func fetchStreamsData(url, authToken string) (*Streams, error) {
	client := &http.Client{Timeout: 30 * time.Second}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	if authToken != "" {
		req.Header.Set("Authorization", "Bearer "+authToken)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch streams: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("repository returned status %d", resp.StatusCode)
	}

	// Parse response using StreamsRepositoryData
	data := &StreamsRepositoryData{}
	err = data.Init(resp.Body, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to parse streams: %w", err)
	}

	streams := data.GetData()
	if streams == nil {
		return nil, fmt.Errorf("no streams data loaded")
	}

	return streams, nil
}
