package jitsu_sdk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/templates"
	"go.uber.org/atomic"
	"strings"
	"sync"
	"time"
)

var ErrSDKSourceCancelled = errors.New("Source runner was cancelled.")

const LatestVersion = "latest"

//SdkSource is an SdkSource CLI driver
type SdkSource struct {
	mutex *sync.RWMutex
	base.AbstractCLIDriver

	activeCommands map[string]*base.SyncCommand

	config *Config
	closed chan struct{}
}

func init() {
	base.RegisterDriver(base.SdkSourceType, NewSdkSource)
	base.RegisterTestConnectionFunc(base.SdkSourceType, TestSdkSource)
}

//NewSdkSource returns SdkSource driver and
//1. writes json files (config, catalog, state) if string/raw json was provided
//2. runs discover and collects catalog.json
func NewSdkSource(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &Config{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	if config.PackageVersion == "" {
		config.PackageVersion = LatestVersion
	}
	base.FillPreconfiguredOauth(config.Package, config.Config)

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, config.Package, "", "", "", "",
		strings.ReplaceAll(config.Package, "-", "_")+"_", "", map[string]string{})
	s := &SdkSource{
		activeCommands: map[string]*base.SyncCommand{},
		mutex:          &sync.RWMutex{},
		config:         config,
		closed:         make(chan struct{}),
	}
	s.AbstractCLIDriver = *abstract

	return s, nil
}

//TestSdkSource tests sdk source connection (runs validator) if docker has been ready otherwise returns errNotReady
func TestSdkSource(sourceConfig *base.SourceConfig) error {
	config := &Config{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}

	if err := config.Validate(); err != nil {
		return err
	}

	if config.PackageVersion == "" {
		config.PackageVersion = LatestVersion
	}
	base.FillPreconfiguredOauth(config.Package, config.Config)

	sourcePlugin := &templates.SourcePlugin{
		Package: config.Package + "@" + config.PackageVersion,
		ID:      sourceConfig.SourceID,
		Type:    base.SdkSourceType,
		Config:  config.Config,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		return err
	}
	return sourceExecutor.Validate()

	//selectedStreamsWithNamespace := selectedStreamsWithNamespace(config)
	//if len(selectedStreamsWithNamespace) > 0 {
	//	airbyteRunner = airbyte.NewRunner(config.DockerImage, config.ImageVersion, "")
	//	catalog, err := airbyteRunner.Discover(config.Config, time.Minute*3)
	//	if err != nil {
	//		return err
	//	}
	//	var missingStreams []base.StreamConfiguration
	//	var missingStreamsStr []string
	//	availableStreams := map[string]interface{}{}
	//	for _, stream := range catalog.Streams {
	//		availableStreams[base.StreamIdentifier(stream.Namespace, stream.Name)] = true
	//	}
	//	for key, stream := range selectedStreamsWithNamespace {
	//		_, ok := availableStreams[key]
	//		if !ok {
	//			missingStreams = append(missingStreams, stream)
	//			missingStreamsStr = append(missingStreamsStr, stream.Name)
	//		}
	//	}
	//	if len(missingStreams) > 0 {
	//		return utils.NewRichError(fmt.Sprintf("selected streams unavailable: %s", strings.Join(missingStreamsStr, ",")), missingStreams)
	//	}
	//}
	//return nil
}

//Ready returns true if catalog is discovered
func (s *SdkSource) Ready() (bool, error) {
	return true, nil
}

func (s *SdkSource) Load(config string, state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, taskCloser base.CLITaskCloser) error {
	if s.IsClosed() {
		return fmt.Errorf("%s has already been closed", s.Type())
	}
	if err := taskCloser.HandleCanceling(); err != nil {
		return err
	}

	sourcePlugin := &templates.SourcePlugin{
		Package: s.config.Package + "@" + s.config.PackageVersion,
		ID:      s.ID(),
		Type:    base.SdkSourceType,
		Config:  s.config.Config,
	}
	sourceExecutor, err := templates.NewSourceExecutor(sourcePlugin)
	if err != nil {
		return err
	}
	sdkSourceRunner := SdkSourceRunner{sourceExecutor: sourceExecutor, config: s.config, closed: atomic.NewBool(false)}
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
		SourceType:       s.config.Package,
		ConnectorOrigin:  s.Type(),
		ConnectorVersion: s.config.PackageVersion,
		Streams:          len(s.config.SelectedStreams),
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
	sourceExecutor *templates.SourceExecutor
	config         *Config
	closed         *atomic.Bool
}

func (s *SdkSourceRunner) Load(taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer) error {
	if s.closed.Load() {
		return ErrSDKSourceCancelled
	}
	output := &base.CLIOutputRepresentation{
		Streams: map[string]*base.StreamRepresentation{},
	}

	for _, stream := range s.config.SelectedStreams {
		if s.closed.Load() {
			taskLogger.INFO("Stopping processing. Task was closed")
			return ErrSDKSourceCancelled
		}
		taskLogger.INFO("Starting processing stream: %s", stream.Name)
		representation := &base.StreamRepresentation{
			StreamName:  stream.Name,
			BatchHeader: &schema.BatchHeader{TableName: stream.Name, Fields: map[string]schema.Field{}},
			Objects:     []map[string]interface{}{},
			NeedClean:   stream.SyncMode == "full_sync",
		}
		output.Streams[stream.Name] = representation
		dataChannel := make(chan []byte, 1000)
		go func() {
			defer close(dataChannel)
			_, err := s.sourceExecutor.Stream(stream.Name, stream, nil, dataChannel)
			if err != nil {
				dataChannel <- []byte(err.Error())
			}
		}()

		for bytes := range dataChannel {
			row := &Row{}
			err := json.Unmarshal(bytes, row)
			if err != nil {
				taskLogger.ERROR("Failed to parse message from source: %s", string(bytes))
				continue
			}
			switch row.Type {
			case "record":
				object, ok := row.Message.(map[string]interface{})
				if !ok {
					taskLogger.ERROR("Record message expected to have type map[string]interface{} found: %T", row.Message)
				}
				representation.Objects = append(representation.Objects, object)
			default:
				taskLogger.ERROR("Message type %s is not supported yet.", row.Type)
			}
		}
		taskLogger.INFO("Stream: %s finished. Objects count: %d", stream.Name, len(representation.Objects))
	}
	if !s.closed.Load() {
		err := dataConsumer.Consume(output)
		return err
	} else {
		taskLogger.WARN("Stopping processing. Task was closed")
		return ErrSDKSourceCancelled
	}
}

func (s SdkSourceRunner) String() string {
	return s.config.Package
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
