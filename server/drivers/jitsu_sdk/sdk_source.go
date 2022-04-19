package jitsu_sdk

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"go.uber.org/atomic"
	"sync"
)

const LatestVersion = "latest"

//SdkSource is an SdkSource CLI driver
type SdkSource struct {
	mutex *sync.RWMutex
	base.AbstractCLIDriver

	activeCommands map[string]*base.SyncCommand

	config                *Config
	streamsRepresentation map[string]*base.StreamRepresentation
	closed                chan struct{}
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

	// ** Table names mapping **
	if len(config.StreamTableNames) > 0 {
		b, _ := json.MarshalIndent(config.StreamTableNames, "", "    ")
		logging.Infof("[%s] configured sdk source stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	var streamsRepresentation map[string]*base.StreamRepresentation
	streamTableNameMapping := map[string]string{}
	catalogDiscovered := atomic.NewBool(false)
	if config.Catalog != nil {
		catalogDiscovered.Store(true)

		//parse streams from config
		streamsRepresentation, err = parseFormattedCatalog(config.Catalog)
		if err != nil {
			return nil, fmt.Errorf("Error parse formatted catalog: %v", err)
		}

		for streamName := range streamsRepresentation {
			streamTableNameMapping[streamName] = config.StreamTableNamesPrefix + streamName
		}
	}

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, config.Package, "", "", "", "",
		config.StreamTableNamesPrefix, "", config.StreamTableNames)
	s := &SdkSource{
		activeCommands:        map[string]*base.SyncCommand{},
		mutex:                 &sync.RWMutex{},
		config:                config,
		streamsRepresentation: streamsRepresentation,
		closed:                make(chan struct{}),
	}
	s.AbstractCLIDriver = *abstract
	s.AbstractCLIDriver.SetStreamTableNameMappingIfNotExists(streamTableNameMapping)

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

//EnsureCatalog does discover if catalog wasn't provided
func (s *SdkSource) EnsureCatalog() {
	//retry := 0
	//for {
	//	if a.IsClosed() {
	//		break
	//	}
	//
	//	if a.catalogDiscovered.Load() {
	//		break
	//	}
	//
	//	catalogPath, streamsRepresentation, err := a.loadCatalog()
	//	if err != nil {
	//		if err == runner.ErrNotReady {
	//			time.Sleep(time.Second)
	//			continue
	//		}
	//
	//		a.mutex.Lock()
	//		a.discoverCatalogLastError = err
	//		a.mutex.Unlock()
	//
	//		retry++
	//
	//		logging.Errorf("[%s] Error configuring airbyte: %v. Scheduled next try after: %d minutes", a.ID(), err, retry)
	//		time.Sleep(time.Duration(retry) * time.Minute)
	//		continue
	//	}
	//
	//	streamTableNameMapping := map[string]string{}
	//	for streamName := range streamsRepresentation {
	//		streamTableNameMapping[streamName] = a.GetTableNamePrefix() + streamName
	//	}
	//
	//	a.mutex.Lock()
	//	a.discoverCatalogLastError = nil
	//	a.mutex.Unlock()
	//
	//	a.SetCatalogPath(catalogPath)
	//	a.streamsRepresentation = streamsRepresentation
	//	a.AbstractCLIDriver.SetStreamTableNameMappingIfNotExists(streamTableNameMapping)
	//	a.catalogDiscovered.Store(true)
	//	return
	//}
}

//Ready returns true if catalog is discovered
func (s *SdkSource) Ready() (bool, error) {
	return true, nil
}

func (s *SdkSource) Load(config string, state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, taskCloser base.CLITaskCloser) error {
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
	for _, stream := range s.config.SelectedStreams {
		dataChannel := make(chan []byte, 1000)
		go func() {
			res, err := sourceExecutor.Stream(stream.Name, stream, nil, dataChannel)
			if err != nil {
				logging.Infof("ERR: %v", err)
				dataChannel <- []byte(err.Error())
				return
			}
			logging.Infof("RES: %+v", res)

			bytes, err := json.Marshal(res)
			if err != nil {
				dataChannel <- []byte(err.Error())
				return
			}
			dataChannel <- bytes
			close(dataChannel)
		}()
		for bytes := range dataChannel {
			logging.Info("DATA: " + string(bytes))
		}
	}
	return nil
}

//GetDriversInfo returns telemetry information about the driver
func (s *SdkSource) GetDriversInfo() *base.DriversInfo {
	return &base.DriversInfo{
		SourceType:       s.config.Package,
		ConnectorOrigin:  s.Type(),
		ConnectorVersion: s.config.PackageVersion,
		Streams:          len(s.streamsRepresentation),
	}
}

func (s *SdkSource) Type() string {
	return base.SdkSourceType
}

//Close kills all runners and returns errors if occurred
func (a *SdkSource) Close() (multiErr error) {
	if a.IsClosed() {
		return nil
	}

	close(a.closed)

	a.mutex.Lock()
	for _, activeCommand := range a.activeCommands {
		logging.Infof("[%s] killing process: %s", a.ID(), activeCommand.Cmd.String())
		if err := activeCommand.Shutdown(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error killing airbyte read command: %v", a.ID(), err))
		}
	}

	a.mutex.Unlock()

	return multiErr
}

//loadCatalog:
//1. discovers source catalog
//2. applies selected streams
//3. reformat catalog to airbyte format and writes it to the file system
//returns catalog
func (s *SdkSource) loadCatalog() (string, map[string]*base.StreamRepresentation, error) {
	//airbyteRunner := airbyte.NewRunner(a.GetTap(), a.config.ImageVersion, "")
	//rawCatalog, err := airbyteRunner.Discover(a.config.Config, 5*time.Minute)
	//if err != nil {
	//	return "", nil, err
	//}
	//
	////apply only selected streams
	//if len(a.selectedStreamsWithNamespace) > 0 {
	//	var selectedStreams []*airbyte.Stream
	//	for _, stream := range rawCatalog.Streams {
	//		if streamConfig, selected := a.selectedStreamsWithNamespace[base.StreamIdentifier(stream.Namespace, stream.Name)]; selected {
	//			if streamConfig.SyncMode != "" {
	//				stream.SyncMode = streamConfig.SyncMode
	//			}
	//			if len(streamConfig.CursorField) > 0 {
	//				stream.SelectedCursorField = streamConfig.CursorField
	//			}
	//			selectedStreams = append(selectedStreams, stream)
	//		}
	//	}
	//
	//	rawCatalog.Streams = selectedStreams
	//}
	//
	//catalog, streamsRepresentation, err := reformatCatalog(a.GetTap(), rawCatalog)
	//if err != nil {
	//	return "", nil, err
	//}
	//
	////write airbyte formatted catalog as file path
	//catalogPath, err := parsers.ParseJSONAsFile(path.Join(a.pathToConfigs, base.CatalogFileName), string(catalog))
	//if err != nil {
	//	return "", nil, fmt.Errorf("Error writing discovered airbyte catalog [%v]: %v", string(catalog), err)
	//}
	//
	//return catalogPath, streamsRepresentation, nil
	return "", nil, nil
}

func (a *SdkSource) IsClosed() bool {
	select {
	case <-a.closed:
		return true
	default:
		return false
	}
}
