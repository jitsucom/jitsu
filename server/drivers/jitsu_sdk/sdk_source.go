package jitsu_sdk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/templates"
	"go.uber.org/atomic"
	"sync"
	"time"
)

var ErrSDKSourceCancelled = errors.New("Source runner was cancelled.")

const LatestVersion = "latest"
const IdField = "__id"

//SdkSource is an SdkSource CLI driver
type SdkSource struct {
	mutex *sync.RWMutex
	base.AbstractCLIDriver

	activeCommands map[string]*base.SyncCommand

	packageName    string
	packageVersion string
	config         map[string]interface{}
	collection     *base.Collection
	closed         chan struct{}
}

func init() {
	base.RegisterDriver(base.SdkSourceType, NewSdkSource)
	base.RegisterTestConnectionFunc(base.SdkSourceType, TestSdkSource)
	//base.RegisterDriver(base.RedisType, func(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	//	sourceConfig.Config["package_name"] = "jitsu-redis-source"
	//	return NewSdkSource(ctx, sourceConfig, collection)
	//})
	//base.RegisterTestConnectionFunc(base.RedisType, func(sourceConfig *base.SourceConfig) error {
	//	sourceConfig.Config["package_name"] = "jitsu-redis-source"
	//	return TestSdkSource(sourceConfig)
	//})
}

//NewSdkSource returns SdkSource driver and
//1. writes json files (config, catalog, state) if string/raw json was provided
//2. runs discover and collects catalog.json
func NewSdkSource(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := sourceConfig.Config
	packageName, ok := config["package_name"].(string)
	if !ok {
		return nil, errors.New("SDK source package is required")
	}
	packageVersion, ok := config["package_version"].(string)
	if !ok {
		packageVersion = LatestVersion
	}

	base.FillPreconfiguredOauth(packageName, config)

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, packageName, "", "", "", "",
		"", "", map[string]string{collection.Name: collection.TableName})
	s := &SdkSource{
		activeCommands: map[string]*base.SyncCommand{},
		mutex:          &sync.RWMutex{},
		packageName:    packageName,
		packageVersion: packageVersion,
		config:         config,
		collection:     collection,
		closed:         make(chan struct{}),
	}
	s.AbstractCLIDriver = *abstract

	return s, nil
}

//TestSdkSource tests sdk source connection (runs validator) if docker has been ready otherwise returns errNotReady
func TestSdkSource(sourceConfig *base.SourceConfig) error {
	config := sourceConfig.Config
	packageName, ok := config["package_name"].(string)
	if !ok {
		return errors.New("SDK source package is required")
	}
	packageVersion, ok := config["package_version"].(string)
	if !ok {
		packageVersion = LatestVersion
	}

	base.FillPreconfiguredOauth(packageName, config)

	sourcePlugin := &templates.SourcePlugin{
		Package: packageName + "@" + packageVersion,
		ID:      sourceConfig.SourceID,
		Type:    base.SdkSourceType,
		Config:  config,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		return err
	}
	defer sourceExecutor.Close()
	return sourceExecutor.Validate()
}

//Ready returns true if catalog is discovered
func (s *SdkSource) Ready() (bool, error) {
	return true, nil
}

func (s *SdkSource) Delete() error {
	return nil
}

func (s *SdkSource) Load(config string, state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, taskCloser base.CLITaskCloser) error {
	if s.IsClosed() {
		return fmt.Errorf("%s has already been closed", s.Type())
	}
	if err := taskCloser.HandleCanceling(); err != nil {
		return err
	}

	sourcePlugin := &templates.SourcePlugin{
		Package: s.packageName + "@" + s.packageVersion,
		ID:      s.ID(),
		Type:    base.SdkSourceType,
		Config:  s.config,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		return err
	}
	sdkSourceRunner := SdkSourceRunner{name: s.packageName, sourceExecutor: sourceExecutor, config: s.config, collection: s.collection, closed: atomic.NewBool(false)}
	defer sdkSourceRunner.Close()
	syncCommand := &base.SyncCommand{
		Cmd:        sdkSourceRunner,
		TaskCloser: taskCloser,
	}
	s.mutex.Lock()
	s.activeCommands[taskCloser.TaskID()] = syncCommand
	s.mutex.Unlock()

	loadDone := make(chan struct{})
	defer func() {
		close(loadDone)

		s.mutex.Lock()
		delete(s.activeCommands, taskCloser.TaskID())
		s.mutex.Unlock()
	}()

	safego.Run(func() {
		ticker := time.NewTicker(3 * time.Second)
		for {
			select {
			case <-loadDone:
				return
			case <-ticker.C:
				if err := taskCloser.HandleCanceling(); err != nil {
					if cancelErr := syncCommand.Cancel(); cancelErr != nil {
						logging.SystemErrorf("error canceling task [%s] sync command: %v", taskCloser.TaskID(), cancelErr)
					}
					return
				}
			}
		}
	})

	return sdkSourceRunner.Load(taskLogger, dataConsumer)
}

//GetDriversInfo returns telemetry information about the driver
func (s *SdkSource) GetDriversInfo() *base.DriversInfo {
	return &base.DriversInfo{
		SourceType:       s.packageName,
		ConnectorOrigin:  s.Type(),
		ConnectorVersion: s.packageVersion,
		Streams:          1,
	}
}

func (s *SdkSource) Type() string {
	return base.SdkSourceType
}

//Close kills all runners and returns errors if occurred
func (s *SdkSource) Close() (multiErr error) {
	if s.IsClosed() {
		return nil
	}

	close(s.closed)

	s.mutex.Lock()
	for _, activeCommand := range s.activeCommands {
		logging.Infof("[%s] killing process: %s", s.ID(), activeCommand.Cmd.String())
		if err := activeCommand.Shutdown(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error killing airbyte read command: %v", s.ID(), err))
		}
	}

	s.mutex.Unlock()

	return multiErr
}

func (s *SdkSource) IsClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

type SdkSourceRunner struct {
	name           string
	sourceExecutor *templates.SourceExecutor
	config         map[string]interface{}
	collection     *base.Collection
	closed         *atomic.Bool
}

func (s *SdkSourceRunner) Load(taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer) error {
	if s.closed.Load() {
		return ErrSDKSourceCancelled
	}
	output := &base.CLIOutputRepresentation{
		Streams: map[string]*base.StreamRepresentation{},
	}

	stream := s.collection
	taskLogger.INFO("Starting processing stream: %s", stream.Name)
	representation := &base.StreamRepresentation{
		StreamName:       stream.Name,
		BatchHeader:      &schema.BatchHeader{TableName: stream.TableName, Fields: map[string]schema.Field{}},
		Objects:          []map[string]interface{}{},
		KeepKeysUnhashed: true,
		NeedClean:        stream.SyncMode == "full_sync",
	}
	output.Streams[stream.Name] = representation
	dataChannel := make(chan interface{}, 1000)
	go func() {
		defer close(dataChannel)
		_, err := s.sourceExecutor.Stream(stream.Type, stream, nil, dataChannel)
		if err != nil {
			dataChannel <- err
		}
	}()

	for rawData := range dataChannel {
		switch data := rawData.(type) {
		case []byte:
			row := &Row{}
			err := json.Unmarshal(data, row)
			if err != nil {
				taskLogger.ERROR("Failed to parse message from source: %s", string(data))
				continue
			}
			switch row.Type {
			case "record":
				object, ok := row.Message.(map[string]interface{})
				if !ok {
					taskLogger.ERROR("Record message expected to have type map[string]interface{} found: %T", row.Message)
				}
				id, ok := object[IdField]
				if ok && representation.KeyFields == nil && fmt.Sprint(id) != "" {
					representation.KeyFields = []string{IdField}
				}
				representation.Objects = append(representation.Objects, object)
			case "log":
				log, ok := row.Message.(map[string]interface{})
				if !ok {
					taskLogger.ERROR("Log message expected to have type map[string]interface{} found: %T", row.Message)
				}
				taskLogger.LOG(log["message"].(string), "Jitsu", logging.ToLevel(log["level"].(string)))
			default:
				taskLogger.ERROR("Message type %s is not supported yet.", row.Type)
			}
		case error:
			return data
		default:
			taskLogger.ERROR("Failed to parse message from source: %+v of type: %T", data, data)
		}

	}
	taskLogger.INFO("Stream: %s finished. Objects count: %d", stream.Name, len(representation.Objects))

	if !s.closed.Load() {
		err := dataConsumer.Consume(output)
		return err
	} else {
		taskLogger.WARN("Stopping processing. Task was closed")
		return ErrSDKSourceCancelled
	}
}

func (s SdkSourceRunner) String() string {
	return s.name + "_" + s.collection.Name
}

func (s SdkSourceRunner) Close() error {
	s.closed.Store(true)
	s.sourceExecutor.Close()
	return nil
}

//Row is a dto for sdk source output row representation
type Row struct {
	Type    string      `json:"type"`
	Message interface{} `json:"message,omitempty"`
}
