package airbyte

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"path"
	"strings"
	"sync"
	"time"
)

const (
	connectionStatusSucceed = "SUCCEEDED"
	connectionStatusFailed  = "FAILED"
)

//Airbyte is an Airbyte CLI driver
type Airbyte struct {
	sync.RWMutex
	base.AbstractCLIDriver

	pathToConfigs            string
	streamsRepresentation    map[string]*base.StreamRepresentation
	catalogDiscovered        *atomic.Bool
	discoverCatalogLastError error
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
	err := base.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}

	if err := config.Validate(); err != nil {
		return nil, err
	}

	if airbyte.Instance == nil {
		return nil, errors.New("airbyte-bridge must be configured")
	}

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
	if err != nil {
		return nil, fmt.Errorf("Error parsing airbyte catalog [%v]: %v", config.Catalog, err)
	}

	// ** Table names mapping **
	if len(config.StreamTableNames) > 0 {
		b, _ := json.MarshalIndent(config.StreamTableNames, "", "    ")
		logging.Infof("[%s] configured airbyte stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	//parse airbyte state as file path
	statePath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.StateFileName), config.InitialState)
	if err != nil {
		return nil, fmt.Errorf("Error parsing airbyte initial state [%v]: %v", config.InitialState, err)
	}

	catalogDiscovered := atomic.NewBool(false)
	if catalogPath != "" {
		catalogDiscovered.Store(true)
	}

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, config.DockerImage, configPath, catalogPath, "", statePath,
		config.StreamTableNamesPrefix, pathToConfigs, config.StreamTableNames)
	s := &Airbyte{
		pathToConfigs:     pathToConfigs,
		catalogDiscovered: catalogDiscovered,
	}
	s.AbstractCLIDriver = *abstract

	safego.Run(s.EnsureCatalog)

	return s, nil
}

//TestAirbyte tests airbyte connection (runs check) if docker has been ready otherwise returns errNotReady
func TestAirbyte(sourceConfig *base.SourceConfig) error {
	driver, err := NewAirbyte(context.Background(), sourceConfig, nil)
	if err != nil {
		return err
	}
	defer driver.Close()

	airbyteDriver, _ := driver.(*Airbyte)

	return airbyteDriver.check()
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

		spec, err := airbyte.Instance.GetOrLoadSpec(a.GetTap())
		if spec == nil {
			if err == nil {
				//no error, just not ready
				time.Sleep(time.Second)
			} else {
				//error
				time.Sleep(time.Second * 30)
			}
			continue
		}

		catalogPath, streamsRepresentation, err := a.doDiscover()
		if err != nil {
			a.Lock()
			a.discoverCatalogLastError = err
			a.Unlock()

			retry++

			logging.Errorf("[%s] Error configuring airbyte: %v. Scheduled next try after: %d minutes", a.ID(), err, retry)
			time.Sleep(time.Duration(retry) * time.Minute)
			continue
		}

		streamTableNameMapping := map[string]string{}
		for streamName := range streamsRepresentation {
			streamTableNameMapping[streamName] = a.GetTableNamePrefix() + streamName
		}

		a.Lock()
		a.discoverCatalogLastError = nil
		a.Unlock()

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
	spec, err := airbyte.Instance.GetOrLoadSpec(a.GetTap())
	if spec == nil {
		if err != nil {
			return false, runner.NewNotReadyError(err.Error())
		}

		return false, runner.NewNotReadyError("")
	}

	//check catalog after docker image because catalog can be configured and discovered by user
	if a.catalogDiscovered.Load() {
		return true, nil
	}

	a.RLock()
	defer a.RUnlock()
	msg := ""
	if a.discoverCatalogLastError != nil {
		msg = a.discoverCatalogLastError.Error()
	}

	return false, runner.NewNotReadyError(msg)
}

func (a *Airbyte) Load(state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer) error {
	if a.IsClosed() {
		return fmt.Errorf("%s has already been closed", a.Type())
	}

	//waiting when airbyte is ready
	ready, readyErr := base.WaitReadiness(a, taskLogger)
	if !ready {
		return readyErr
	}

	args := []string{"run", "--rm", "-i", "-v", fmt.Sprintf("%s:%s", airbyte.Instance.WorkspaceVolume, airbyte.VolumeAlias), airbyte.Instance.ReformatImageName(a.GetTap()), "read", "--config", path.Join(airbyte.VolumeAlias, a.ID(), a.GetTap(), base.ConfigFileName), "--catalog", path.Join(airbyte.VolumeAlias, a.ID(), a.GetTap(), base.CatalogFileName)}

	statePath, err := a.GetStateFilePath(state)
	if err != nil {
		return err
	}

	if statePath != "" {
		args = append(args, "--state", path.Join(airbyte.VolumeAlias, a.ID(), a.GetTap(), base.StateFileName))
	}

	sop := &streamOutputParser{
		dataConsumer:          dataConsumer,
		streamsRepresentation: a.streamsRepresentation,
		logger:                taskLogger,
	}

	return a.LoadAndParse(taskLogger, sop, airbyte.Instance.LogWriter, airbyte.Command, args...)
}

//Check runs airbyte check command
//returns notReadyErr if an airbyte image isn't ready
//returns err if connection failed
func (a *Airbyte) check() error {
	spec, err := airbyte.Instance.GetOrLoadSpec(a.GetTap())
	if spec == nil && err != nil {
		return runner.NewNotReadyError(err.Error())
	}

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()

	args := []string{"run", "--rm", "-i", "-v", fmt.Sprintf("%s:%s", airbyte.Instance.WorkspaceVolume, airbyte.VolumeAlias), airbyte.Instance.ReformatImageName(a.GetTap()), "check", "--config", path.Join(airbyte.VolumeAlias, a.ID(), a.GetTap(), base.ConfigFileName)}
	if err := runner.ExecCmd(airbyte.BridgeType, airbyte.Command, outWriter, errWriter, args...); err != nil {
		return errors.New(airbyte.Instance.BuildMsg("Error executing airbyte check:", outWriter, errWriter, err))
	}

	parts := strings.Split(outWriter.String(), "\n")
	for _, p := range parts {
		parsedRow := &airbyte.Row{}
		if err := json.Unmarshal([]byte(p), parsedRow); err == nil {
			if parsedRow.Type == airbyte.ConnectionStatusType && parsedRow.ConnectionStatus != nil {
				switch parsedRow.ConnectionStatus.Status {
				case connectionStatusSucceed:
					return nil
				case connectionStatusFailed:
					return errors.New(parsedRow.ConnectionStatus.Message)
				default:
					return fmt.Errorf("unknown airbyte connection status [%s]: %s", parsedRow.ConnectionStatus.Status, parsedRow.ConnectionStatus.Message)
				}

			}
		}
	}

	return fmt.Errorf("Error parsing airbyte check result as json: %s", outWriter.String())
}

func (a *Airbyte) Type() string {
	return base.AirbyteType
}

//doDiscover discovers source catalog
//makes streams {"selected": true}
//reformat catalog to airbyte format
//returns catalog
func (a *Airbyte) doDiscover() (string, map[string]*base.StreamRepresentation, error) {
	outWriter := logging.NewStringWriter()
	errStrWriter := logging.NewStringWriter()
	dualStdErrWriter := logging.Dual{FileWriter: errStrWriter, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", a.ID()), airbyte.Instance.LogWriter)}

	args := []string{"run", "--rm", "-i", "-v", fmt.Sprintf("%s:%s", airbyte.Instance.WorkspaceVolume, airbyte.VolumeAlias), airbyte.Instance.ReformatImageName(a.GetTap()), "discover", "--config", path.Join(airbyte.VolumeAlias, a.ID(), a.GetTap(), base.ConfigFileName)}

	err := runner.ExecCmd(base.AirbyteType, airbyte.Command, outWriter, dualStdErrWriter, args...)
	if err != nil {
		return "", nil, fmt.Errorf("Error airbyte --discover: %v. %s", err, errStrWriter.String())
	}

	catalog, streamsRepresentation, err := parseCatalog(outWriter)
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
