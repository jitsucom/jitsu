package airbyte

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/utils"
	"go.uber.org/atomic"
	"path"
	"strings"
	"sync"
	"time"
)

//Airbyte is an Airbyte CLI driver
type Airbyte struct {
	mutex *sync.RWMutex
	base.AbstractCLIDriver

	activeCommands map[string]*base.SyncCommand

	config                       *Config
	selectedStreamsWithNamespace map[string]base.StreamConfiguration
	pathToConfigs                string
	streamsRepresentation        map[string]*base.StreamRepresentation
	catalogDiscovered            *atomic.Bool
	discoverCatalogLastError     error

	closed chan struct{}
}

func init() {
	base.RegisterDriver(base.AirbyteType, NewAirbyte)
	base.RegisterTestConnectionFunc(base.AirbyteType, TestAirbyte)
}

//NewAirbyte returns Airbyte driver and
//1. writes json files (config, catalog, state) if string/raw json was provided
//2. runs discover and collects catalog.json
func NewAirbyte(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &Config{}
	err := jsonutils.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	if airbyte.Instance == nil {
		return nil, errors.New("airbyte-bridge must be configured")
	}

	config.DockerImage = strings.TrimPrefix(config.DockerImage, airbyte.DockerImageRepositoryPrefix)
	if config.ImageVersion == "" {
		config.ImageVersion = airbyte.LatestVersion
	}
	base.FillPreconfiguredOauth(config.DockerImage, config.Config)

	pathToConfigs := path.Join(airbyte.Instance.ConfigDir, sourceConfig.SourceID, config.DockerImage)

	if err := logging.EnsureDir(pathToConfigs); err != nil {
		return nil, fmt.Errorf("Error creating airbyte config dir: %v", err)
	}

	//parse airbyte config as file path
	configPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.ConfigFileName), config.Config)
	if err != nil {
		return nil, fmt.Errorf("Error parsing airbyte config [%v]: %v", config.Config, err)
	}

	//parse airbyte catalog as file path
	catalogPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.CatalogFileName), config.Catalog)
	if err != nil && err != parsers.ErrValueIsNil {
		return nil, fmt.Errorf("Error parsing airbyte catalog [%v]: %v", config.Catalog, err)
	}

	// ** Table names mapping **
	if len(config.StreamTableNames) > 0 {
		b, _ := json.MarshalIndent(config.StreamTableNames, "", "    ")
		logging.Infof("[%s] configured airbyte stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	//parse airbyte state as file path
	statePath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.StateFileName), config.InitialState)
	if err != nil && err != parsers.ErrValueIsNil {
		return nil, fmt.Errorf("Error parsing airbyte initial state [%v]: %v", config.InitialState, err)
	}

	var streamsRepresentation map[string]*base.StreamRepresentation
	streamTableNameMapping := map[string]string{}
	catalogDiscovered := atomic.NewBool(false)
	if catalogPath != "" {
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

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, config.DockerImage, configPath, catalogPath, "", statePath,
		config.StreamTableNamesPrefix, pathToConfigs, config.StreamTableNames)
	s := &Airbyte{
		mutex:                        &sync.RWMutex{},
		activeCommands:               map[string]*base.SyncCommand{},
		config:                       config,
		selectedStreamsWithNamespace: selectedStreamsWithNamespace(config),
		pathToConfigs:                pathToConfigs,
		catalogDiscovered:            catalogDiscovered,
		streamsRepresentation:        streamsRepresentation,
		closed:                       make(chan struct{}),
	}
	s.AbstractCLIDriver = *abstract
	s.AbstractCLIDriver.SetStreamTableNameMappingIfNotExists(streamTableNameMapping)

	safego.Run(s.EnsureCatalog)

	return s, nil
}

//TestAirbyte tests airbyte connection (runs check) if docker has been ready otherwise returns errNotReady
func TestAirbyte(sourceConfig *base.SourceConfig) error {
	config := &Config{}
	if err := jsonutils.UnmarshalConfig(sourceConfig.Config, config); err != nil {
		return err
	}

	if err := config.Validate(); err != nil {
		return err
	}

	config.DockerImage = strings.TrimPrefix(config.DockerImage, airbyte.DockerImageRepositoryPrefix)
	if config.ImageVersion == "" {
		config.ImageVersion = airbyte.LatestVersion
	}
	base.FillPreconfiguredOauth(config.DockerImage, config.Config)
	airbyteRunner := airbyte.NewRunner(sourceConfig.SourceID, config.DockerImage, config.ImageVersion, "")

	if err := airbyteRunner.Check(config.Config); err != nil {
		return err
	}

	selectedStreamsWithNamespace := selectedStreamsWithNamespace(config)
	if len(selectedStreamsWithNamespace) > 0 {
		airbyteRunner = airbyte.NewRunner(sourceConfig.SourceID, config.DockerImage, config.ImageVersion, "")
		catalog, err := airbyteRunner.Discover(config.Config, time.Minute*3)
		if err != nil {
			return err
		}
		var missingStreams []base.StreamConfiguration
		var missingStreamsStr []string
		availableStreams := map[string]interface{}{}
		for _, stream := range catalog.Streams {
			availableStreams[base.StreamIdentifier(stream.Namespace, stream.Name)] = true
		}
		for key, stream := range selectedStreamsWithNamespace {
			_, ok := availableStreams[key]
			if !ok {
				missingStreams = append(missingStreams, stream)
				missingStreamsStr = append(missingStreamsStr, stream.Name)
			}
		}
		if len(missingStreams) > 0 {
			return utils.NewRichError(fmt.Sprintf("selected streams unavailable: %s", strings.Join(missingStreamsStr, ",")), missingStreams)
		}
	}
	return nil
}

//EnsureCatalog does discover if catalog wasn't provided
func (a *Airbyte) EnsureCatalog() {
	retry := 0
	for {
		if a.IsClosed() {
			break
		}

		if a.catalogDiscovered.Load() {
			break
		}

		catalogPath, streamsRepresentation, err := a.loadCatalog()
		if err != nil {
			if err == runner.ErrNotReady {
				time.Sleep(time.Second)
				continue
			}

			a.mutex.Lock()
			a.discoverCatalogLastError = err
			a.mutex.Unlock()

			retry++

			logging.Errorf("[%s] Error configuring airbyte: %v. Scheduled next try after: %d minutes", a.ID(), err, retry)
			time.Sleep(time.Duration(retry) * time.Minute)
			continue
		}

		streamTableNameMapping := map[string]string{}
		for streamName := range streamsRepresentation {
			streamTableNameMapping[streamName] = a.GetTableNamePrefix() + streamName
		}

		a.mutex.Lock()
		a.discoverCatalogLastError = nil
		a.mutex.Unlock()

		a.SetCatalogPath(catalogPath)
		a.streamsRepresentation = streamsRepresentation
		a.AbstractCLIDriver.SetStreamTableNameMappingIfNotExists(streamTableNameMapping)
		a.catalogDiscovered.Store(true)
		return
	}
}

//Ready returns true if catalog is discovered
func (a *Airbyte) Ready() (bool, error) {
	//check if docker image isn't pulled
	ready := airbyte.Instance.IsImagePulled(airbyte.Instance.AddAirbytePrefix(a.GetTap()), a.config.ImageVersion)
	if !ready {
		return false, runner.ErrNotReady
	}

	//check catalog after docker image because catalog can be configured and discovered by user
	if a.catalogDiscovered.Load() {
		return true, nil
	}

	a.mutex.RLock()
	defer a.mutex.RUnlock()
	msg := ""
	if a.discoverCatalogLastError != nil {
		msg = a.discoverCatalogLastError.Error()
	}

	return false, runner.NewCompositeNotReadyError(msg)
}

func (a *Airbyte) Load(config string, state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, taskCloser base.CLITaskCloser) error {
	if a.IsClosed() {
		return fmt.Errorf("%s has already been closed", a.Type())
	}

	if err := taskCloser.HandleCanceling(); err != nil {
		return err
	}

	//waiting when airbyte is ready
	ready, readyErr := base.WaitReadiness(a, taskLogger)
	if !ready {
		return readyErr
	}

	statePath, err := a.GetStateFilePath(state)
	if err != nil {
		return err
	}

	airbyteRunner := airbyte.NewRunner(a.ID(), a.GetTap(), a.config.ImageVersion, taskCloser.TaskID())

	syncCommand := &base.SyncCommand{
		Cmd:        airbyteRunner,
		TaskCloser: taskCloser,
	}
	a.mutex.Lock()
	a.activeCommands[taskCloser.TaskID()] = syncCommand
	a.mutex.Unlock()

	loadDone := make(chan struct{})
	defer func() {
		close(loadDone)

		a.mutex.Lock()
		delete(a.activeCommands, taskCloser.TaskID())
		a.mutex.Unlock()
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

	return airbyteRunner.Read(dataConsumer, a.streamsRepresentation, taskLogger, taskCloser, a.ID(), statePath)
}

//GetDriversInfo returns telemetry information about the driver
func (a *Airbyte) GetDriversInfo() *base.DriversInfo {
	return &base.DriversInfo{
		SourceType:       a.config.DockerImage,
		ConnectorOrigin:  a.Type(),
		ConnectorVersion: a.config.ImageVersion,
		Streams:          len(a.streamsRepresentation),
	}
}

func (a *Airbyte) Type() string {
	return base.AirbyteType
}

//Close kills all runners and returns errors if occurred
func (a *Airbyte) Close() (multiErr error) {
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
func (a *Airbyte) loadCatalog() (string, map[string]*base.StreamRepresentation, error) {
	airbyteRunner := airbyte.NewRunner(a.ID(), a.GetTap(), a.config.ImageVersion, "")
	rawCatalog, err := airbyteRunner.Discover(a.config.Config, 5*time.Minute)
	if err != nil {
		return "", nil, err
	}

	//apply only selected streams
	if len(a.selectedStreamsWithNamespace) > 0 {
		var selectedStreams []*airbyte.Stream
		for _, stream := range rawCatalog.Streams {
			if streamConfig, selected := a.selectedStreamsWithNamespace[base.StreamIdentifier(stream.Namespace, stream.Name)]; selected {
				if streamConfig.SyncMode != "" {
					stream.SyncMode = streamConfig.SyncMode
				}
				if len(streamConfig.CursorField) > 0 {
					stream.SelectedCursorField = streamConfig.CursorField
				}
				selectedStreams = append(selectedStreams, stream)
			}
		}

		rawCatalog.Streams = selectedStreams
	}

	catalog, streamsRepresentation, err := reformatCatalog(a.GetTap(), rawCatalog)
	if err != nil {
		return "", nil, err
	}

	//write airbyte formatted catalog as file path
	catalogPath, err := parsers.ParseJSONAsFile(path.Join(a.pathToConfigs, base.CatalogFileName), string(catalog))
	if err != nil {
		return "", nil, fmt.Errorf("Error writing discovered airbyte catalog [%v]: %v", string(catalog), err)
	}

	return catalogPath, streamsRepresentation, nil
}

func selectedStreamsWithNamespace(config *Config) map[string]base.StreamConfiguration {
	var selectedStreamsWithNamespace map[string]base.StreamConfiguration
	if len(config.SelectedStreams) > 0 {
		selectedStreamsWithNamespace = map[string]base.StreamConfiguration{}
		for _, sc := range config.SelectedStreams {
			selectedStreamsWithNamespace[base.StreamIdentifier(sc.Namespace, sc.Name)] = sc
		}
	}
	return selectedStreamsWithNamespace
}

func (a *Airbyte) IsClosed() bool {
	select {
	case <-a.closed:
		return true
	default:
		return false
	}
}
