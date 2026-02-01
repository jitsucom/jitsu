package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type RepositoryConfig struct {
	RepositoryURL              string `mapstructure:"REPOSITORY_URL"`
	RepositoryAuthToken        string `mapstructure:"REPOSITORY_AUTH_TOKEN"`
	RepositoryRefreshPeriodSec int    `mapstructure:"REPOSITORY_REFRESH_PERIOD_SEC" default:"2"`
}

func (r *RepositoryConfig) PostInit(settings *appbase.AppSettings) error {
	return nil
}

type Streams struct {
	streams                   []*StreamWithDestinations
	apiKeyBindings            map[string]*ApiKeyBinding
	streamsByPlainKeyOrIds    map[string]*StreamWithDestinations
	s2sStreamsByPlainKeyOrIds map[string]*StreamWithDestinations
	streamsByDomains          map[string][]*StreamWithDestinations
	lastModified              time.Time
}

func (s *Streams) getStreamByKeyId(keyId string) *ApiKeyBinding {
	return s.apiKeyBindings[keyId]
}

func (s *Streams) GetStreamByPlainKeyOrId(plainKeyOrSlug string) *StreamWithDestinations {
	return s.streamsByPlainKeyOrIds[plainKeyOrSlug]
}

func (s *Streams) GetS2SStreamByPlainKeyOrId(plainKeyOrSlug string) *StreamWithDestinations {
	return s.s2sStreamsByPlainKeyOrIds[plainKeyOrSlug]
}

func (s *Streams) GetStreamsByDomain(domain string) []*StreamWithDestinations {
	return s.streamsByDomains[domain]
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
	apiKeyBindings := map[string]*ApiKeyBinding{}
	streamsByPlainKeyOrIds := map[string]*StreamWithDestinations{}
	s2sStreamsByPlainKeyOrIds := map[string]*StreamWithDestinations{}
	streamsByDomains := map[string][]*StreamWithDestinations{}
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
		s2sStreamsByPlainKeyOrIds[swd.Stream.Id] = &swd
		for _, domain := range swd.Stream.Domains {
			domainStreams, ok := streamsByDomains[domain]
			if !ok {
				domainStreams = make([]*StreamWithDestinations, 0, 1)
			}
			streamsByDomains[domain] = append(domainStreams, &swd)
		}
		for _, key := range swd.Stream.PublicKeys {
			if key.Plaintext != "" {
				streamsByPlainKeyOrIds[key.Plaintext] = &swd
			}
			if key.Id != "" && key.Hash != "" {
				apiKeyBindings[key.Id] = &ApiKeyBinding{
					Hash:     key.Hash,
					KeyType:  "browser",
					StreamId: swd.Stream.Id,
				}
			}
		}
		for _, key := range swd.Stream.PrivateKeys {
			if key.Plaintext != "" {
				s2sStreamsByPlainKeyOrIds[key.Plaintext] = &swd
			}
			if key.Id != "" && key.Hash != "" {
				apiKeyBindings[key.Id] = &ApiKeyBinding{
					Hash:     key.Hash,
					KeyType:  "s2s",
					StreamId: swd.Stream.Id,
				}
			}
		}
	}

	// read closing bracket
	_, err = dec.Token()
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := Streams{
		streams:                   streams,
		apiKeyBindings:            apiKeyBindings,
		streamsByPlainKeyOrIds:    streamsByPlainKeyOrIds,
		s2sStreamsByPlainKeyOrIds: s2sStreamsByPlainKeyOrIds,
		streamsByDomains:          streamsByDomains,
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
	return appbase.NewHTTPRepository[Streams]("streams-with-destinations", url, token, appbase.HTTPTagLastModified, &StreamsRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}

type DataLayout string

const (
	DataLayoutSegmentCompatible  = "segment-compatible"
	DataLayoutSegmentSingleTable = "segment-single-table"
	DataLayoutJitsuLegacy        = "jitsu-legacy"
)

type ApiKey struct {
	Id        string `json:"id"`
	Plaintext string `json:"plaintext"`
	Hash      string `json:"hash"`
	Hint      string `json:"hint"`
}

type ApiKeyBinding struct {
	Hash     string `json:"hash"`
	KeyType  string `json:"keyType"`
	StreamId string `json:"streamId"`
}

type StreamConfig struct {
	Id                          string   `json:"id"`
	Type                        string   `json:"type"`
	WorkspaceId                 string   `json:"workspaceId"`
	Name                        string   `json:"name"`
	Domains                     []string `json:"domains"`
	AuthorizedJavaScriptDomains string   `json:"authorizedJavaScriptDomains"`
	Strict                      bool     `json:"strict"`
	DeduplicateWindowMs         int      `json:"deduplicateWindowMs"`
	PublicKeys                  []ApiKey `json:"publicKeys"`
	PrivateKeys                 []ApiKey `json:"privateKeys"`
}

type ShortDestinationConfig struct {
	TagDestinationConfig
	Id              string         `json:"id"`
	ConnectionId    string         `json:"connectionId,omitempty"`
	DestinationType string         `json:"destinationType"`
	Options         map[string]any `json:"options,omitempty"`
	Credentials     map[string]any `json:"credentials,omitempty"`
}

func (s *ShortDestinationConfig) CloneForJsLib() *ShortDestinationConfig {
	return &ShortDestinationConfig{
		TagDestinationConfig: s.TagDestinationConfig,
		Id:                   s.Id,
		DestinationType:      s.DestinationType,
		Options: utils.MapFilter(s.Options, func(s string, _ any) bool {
			return s != "functions" && s != "functionsClasses"
		}),
		Credentials: s.Credentials,
	}
}

type TagDestinationConfig struct {
	Mode string `json:"mode,omitempty"`
	Code string `json:"code,omitempty"`
}

type StreamWithDestinations struct {
	Stream                   StreamConfig             `json:"stream"`
	UpdateAt                 time.Time                `json:"updatedAt"`
	BackupEnabled            bool                     `json:"backupEnabled"`
	Throttle                 int                      `json:"throttle"`
	Shard                    int                      `json:"shard"`
	Destinations             []ShortDestinationConfig `json:"destinations"`
	SynchronousDestinations  []*ShortDestinationConfig
	AsynchronousDestinations []*ShortDestinationConfig
}

func (s *StreamWithDestinations) init() {
	s.SynchronousDestinations = make([]*ShortDestinationConfig, 0)
	s.AsynchronousDestinations = make([]*ShortDestinationConfig, 0)
	for _, d := range s.Destinations {
		if d.Id == "" || d.DestinationType == "" {
			continue
		}
		_, ok := DeviceOptions[d.DestinationType]
		cp := d
		if ok {
			s.SynchronousDestinations = append(s.SynchronousDestinations, &cp)
		} else {
			s.AsynchronousDestinations = append(s.AsynchronousDestinations, &cp)
		}
	}
}
