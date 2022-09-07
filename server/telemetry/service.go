package telemetry

import (
	"bytes"
	"encoding/json"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/runtime"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/spf13/viper"
	"go.uber.org/atomic"
	"net/http"
	"time"
)

var reloadEvery = 20 * time.Second

// Configuration dto for telemetry enable/disable configuration
type Configuration struct {
	Disabled map[string]bool `json:"disabled,omitempty"`
}

var instance Service

// Service is used for sending telemetry
type Service struct {
	reqFactory *RequestFactory
	client     *http.Client
	url        string

	usageOptOut *atomic.Bool

	collector *Collector
	usageCh   chan *Request

	flushCh chan bool
	closed  bool
}

// InitTest for tests only
func InitTest() {
	instance = Service{usageOptOut: atomic.NewBool(true)}
}

// InitFromViper creates telemetry instance, starts goroutine
// if configuration is provided as a url - starts another goroutine (see resources.Watch)
func InitFromViper(telemetrySourceURL, serviceName, commit, tag, builtAt, dockerHubID string) {
	Init(serviceName, commit, tag, builtAt, dockerHubID)

	if telemetrySourceURL != "" {
		resources.Watch(serviceName, telemetrySourceURL, resources.LoadFromHTTP, reInit, reloadEvery)
	} else {
		instance.usageOptOut = atomic.NewBool(viper.GetBool("server.telemetry.disabled.usage"))
	}
}

// Init creates telemetry instance and starts goroutine
func Init(serviceName, commit, tag, builtAt, dockerHubID string) {
	instance = Service{
		reqFactory: newRequestFactory(serviceName, commit, tag, builtAt, dockerHubID),
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		url:         "https://t.jitsu.com/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: atomic.NewBool(false),

		collector: newCollector(),

		usageCh: make(chan *Request, 100),

		flushCh: make(chan bool, 1),
	}

	instance.startUsage()
}

func EnrichMetaStorage(storage meta.Storage) {
	instance.reqFactory.iInfo.MetaStorage = storage.Type()
}

// EnrichSystemInfo enriches request factory (every request) with system information (CPU/RAM)
func EnrichSystemInfo(clusterID string, systemInfo *runtime.Info) {
	instance.reqFactory.iInfo.ClusterID = clusterID

	instance.reqFactory.iInfo.RAMTotalGB = systemInfo.RAMTotalGB
	instance.reqFactory.iInfo.RAMFreeGB = systemInfo.RAMFreeGB
	instance.reqFactory.iInfo.RAMUsage = systemInfo.RAMUsage

	instance.reqFactory.iInfo.CPUInfoInstances = systemInfo.CPUInfoInstances
	instance.reqFactory.iInfo.CPUCores = systemInfo.CPUCores
	instance.reqFactory.iInfo.CPUModelName = systemInfo.CPUModelName
	instance.reqFactory.iInfo.CPUModel = systemInfo.CPUModel
	instance.reqFactory.iInfo.CPUFamily = systemInfo.CPUFamily
	instance.reqFactory.iInfo.CPUVendor = systemInfo.CPUVendor
}

func GetSystemInfo() *InstanceInfo {
	return instance.reqFactory.iInfo
}

// reInit initializes telemetry configuration
// it is used in case of reloadable telemetry configuration (when configuration is provided as a url)
func reInit(payload []byte) {
	c := &Configuration{}
	err := json.Unmarshal(payload, c)
	if err != nil {
		return
	}

	if c.Disabled != nil {
		optOut, ok := c.Disabled["usage"]
		if ok {
			if instance.usageOptOut == nil {
				instance.usageOptOut = atomic.NewBool(false)
			}

			instance.usageOptOut.Store(optOut)
		}
	}
}

// ServerStart puts server start event into the queue
func ServerStart() {
	instance.usage(&Usage{ServerStart: 1})
}

// ServerStop puts server stop event into the queue
func ServerStop() {
	instance.usage(&Usage{ServerStop: 1})
}

// CLIStart puts cli start event into the queue
func CLIStart(command string, dateFilters, state bool, chunkSize int64) {
	instance.usage(&Usage{CLIStart: 1, CLICommand: command, CLIDateFilters: dateFilters, CLIState: state, CLIChunkSize: chunkSize})
}

// PushedEventsPerSrc increments events collector counter per Src
func PushedEventsPerSrc(sourceID, destinationID string, quantityPerSrc map[string]int) {
	if !instance.usageOptOut.Load() {
		for src, quantity := range quantityPerSrc {
			Event(sourceID, destinationID, src, "", quantity)
		}
	}
}

// Event increments events collector counter
func Event(sourceID, destinationID, src, sourceType string, quantity int) {
	if !instance.usageOptOut.Load() {
		instance.collector.Event(resources.GetStringHash(sourceID), resources.GetStringHash(destinationID), src, sourceType, uint64(quantity))
	}
}

// PushedErrorsPerSrc increments errors collector counter per Src
func PushedErrorsPerSrc(sourceID, destinationID string, quantityPerSrc map[string]int) {
	if !instance.usageOptOut.Load() {
		for src, quantity := range quantityPerSrc {
			Error(sourceID, destinationID, src, "", int(quantity))
		}
	}
}

// Error increments errors collector counter
func Error(sourceID, destinationID, src, sourceType string, quantity int) {
	if !instance.usageOptOut.Load() {
		instance.collector.Error(resources.GetStringHash(sourceID), resources.GetStringHash(destinationID), src, sourceType, uint64(quantity))
	}
}

// Destination puts usage event with hashed destination id and type
func Destination(destinationID, destinationType, mode, mappingsStyle string, usersRecognition, primaryKeysPresent bool) {
	if !instance.usageOptOut.Load() {
		instance.usageCh <- instance.reqFactory.fromUsage(&Usage{
			Destination:        resources.GetStringHash(destinationID),
			DestinationType:    destinationType,
			DestinationMode:    mode,
			DestinationMapping: mappingsStyle,
			DestinationPkKeys:  primaryKeysPresent,
			UsersRecognition:   usersRecognition,
		})
	}
}

// Source puts usage event with hashed source id and type
func Source(sourceID, sourceType, sourceConnectorOrigin, sourceConnectorVersion, sourceSchedule string, streams int) {
	if !instance.usageOptOut.Load() {
		instance.usageCh <- instance.reqFactory.fromUsage(&Usage{
			Source:                 resources.GetStringHash(sourceID),
			SourceType:             sourceType,
			SourceConnectorOrigin:  sourceConnectorOrigin,
			SourceConnectorVersion: sourceConnectorVersion,
			SourceSchedule:         sourceSchedule,
			SourceStreams:          streams,
		})
	}
}

// SourceTaskStatus puts task status usage event with hashed source id, task id and type
func SourceTaskStatus(taskID, sourceID, sourceType, collection, status, error, createdAt, startedAt, finishedAt string) {
	if !instance.usageOptOut.Load() {
		instance.usageCh <- instance.reqFactory.fromUsage(&Usage{
			Source:         resources.GetStringHash(sourceID),
			SourceType:     sourceType,
			Task:           resources.GetStringHash(taskID),
			TaskCollection: collection,
			TaskStatus:     status,
			TaskError:      error,
			TaskCreatedAt:  createdAt,
			TaskStartedAt:  startedAt,
			TaskFinishedAt: finishedAt,
		})
	}
}

// Coordination puts usage event with coordination service type
func Coordination(serviceType string) {
	if !instance.usageOptOut.Load() {
		instance.usageCh <- instance.reqFactory.fromUsage(&Usage{
			Coordination: serviceType,
		})
	}
}

// User puts user request into the queue
// it is used in manager
func User(user *UserData) {
	instance.usageCh <- instance.reqFactory.fromUser(user)
}

func (s *Service) usage(usage *Usage) {
	if !s.usageOptOut.Load() {
		select {
		case instance.usageCh <- instance.reqFactory.fromUsage(usage):
		default:
		}
	}
}

func (s *Service) startUsage() {
	ticker := time.NewTicker(10 * time.Minute)
	safego.RunWithRestart(func() {
		for {
			if instance.closed {
				ticker.Stop()
				break
			}

			select {
			case <-ticker.C:
				//sends via channel
				usage := s.getUsage()
				for _, u := range usage {
					instance.usage(u)
				}
			case <-s.flushCh:
				//sends immediately
				usage := s.getUsage()
				for _, u := range usage {
					s.send(instance.reqFactory.fromUsage(u))
				}
			}
		}
	})

	safego.RunWithRestart(func() {
		for {
			if instance.closed {
				break
			}

			//wait until configuration is changed
			if instance.usageOptOut.Load() {
				time.Sleep(reloadEvery)
				continue
			}

			req := <-s.usageCh
			s.send(req)
		}
	})
}

func (s *Service) send(req *Request) {
	if b, err := json.Marshal(req); err == nil {
		s.client.Post(s.url, "application/json", bytes.NewBuffer(b))
	}
}

func (s *Service) getUsage() []*Usage {
	var usage []*Usage
	eventsQuantity, errorsQuantity := s.collector.Cut()

	for key, quantity := range eventsQuantity {
		usage = append(usage, &Usage{
			Events:      quantity,
			EventsSrc:   key.src,
			Source:      key.sourceID,
			Destination: key.destinationID,
			SourceType:  key.sourceType,
		})
	}

	for key, quantity := range errorsQuantity {
		usage = append(usage, &Usage{
			Errors:      quantity,
			EventsSrc:   key.src,
			Source:      key.sourceID,
			Destination: key.destinationID,
			SourceType:  key.sourceType,
		})
	}

	return usage
}

// Flush sends all requests that are in a queue
func Flush() {
	instance.flushCh <- true
}

// Close stops underline goroutines
func Close() {
	instance.closed = true
}
