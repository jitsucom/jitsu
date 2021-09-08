package base

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"io"
	"os/exec"
	"path"
	"runtime/debug"
	"strings"
	"sync"
)

const (
	StateFileName      = "state.json"
	ConfigFileName     = "config.json"
	CatalogFileName    = "catalog.json"
	PropertiesFileName = "properties.json"
)

//AbstractCLIDriver is an abstract implementation of CLI drivers such as Singer or Airbyte
type AbstractCLIDriver struct {
	mutex    *sync.RWMutex
	commands map[string]*SyncCommand

	sourceID string
	tap      string

	configPath       string
	catalogPath      string
	propertiesPath   string
	initialStatePath string

	pathToConfigs    string
	tableNamePrefix  string
	streamTableNames map[string]string

	closed *atomic.Bool
}

//NewAbstractCLIDriver returns configured AbstractCLIDriver
func NewAbstractCLIDriver(sourceID, tap, configPath, catalogPath, propertiesPath, initialStatePath, prefix, pathToConfigs string,
	tableNameMappings map[string]string) *AbstractCLIDriver {
	return &AbstractCLIDriver{
		mutex:            &sync.RWMutex{},
		commands:         map[string]*SyncCommand{},
		sourceID:         sourceID,
		tap:              tap,
		configPath:       configPath,
		catalogPath:      catalogPath,
		propertiesPath:   propertiesPath,
		initialStatePath: initialStatePath,
		tableNamePrefix:  prefix,
		pathToConfigs:    pathToConfigs,
		streamTableNames: tableNameMappings,
		closed:           atomic.NewBool(false),
	}
}

//ID returns sourceID
func (acd *AbstractCLIDriver) ID() string {
	return acd.sourceID
}

//GetStateFilePath returns input state as a filepath or returns initial state
func (acd *AbstractCLIDriver) GetStateFilePath(state string) (string, error) {
	//override initial state with existing one and put it to a file
	var statePath string
	var err error
	if state != "" {
		statePath, err = parsers.ParseJSONAsFile(path.Join(acd.pathToConfigs, StateFileName), state)
		if err != nil {
			return "", fmt.Errorf("Error parsing state %s: %v", state, err)
		}

		return statePath, nil
	}

	return acd.initialStatePath, nil
}

//SetCatalogPath sets catalog path
func (acd *AbstractCLIDriver) SetCatalogPath(catalogPath string) {
	acd.catalogPath = catalogPath
}

//SetPropertiesPath sets properties path
func (acd *AbstractCLIDriver) SetPropertiesPath(propertiesPath string) {
	acd.propertiesPath = propertiesPath
}

//GetCatalogPath returns catalog path
func (acd *AbstractCLIDriver) GetCatalogPath() string {
	return acd.catalogPath
}

//GetConfigPath returns config path
func (acd *AbstractCLIDriver) GetConfigPath() string {
	return acd.configPath
}

//GetPropertiesPath returns properties path
func (acd *AbstractCLIDriver) GetPropertiesPath() string {
	return acd.propertiesPath
}

//SetStreamTableNameMappingIfNotExists sets stream table name mapping if not exists
func (acd *AbstractCLIDriver) SetStreamTableNameMappingIfNotExists(streamTableNameMappings map[string]string) {
	for name, value := range streamTableNameMappings {
		if _, ok := acd.streamTableNames[name]; !ok {
			acd.streamTableNames[name] = value
		}
	}
}

//GetStreamTableNameMapping returns stream - table names mapping
func (acd *AbstractCLIDriver) GetStreamTableNameMapping() map[string]string {
	result := map[string]string{}
	for name, value := range acd.streamTableNames {
		result[name] = value
	}

	return result
}

//LoadAndParse runs CLI command and consumes output
func (acd *AbstractCLIDriver) LoadAndParse(taskLogger logging.TaskLogger, cliParser CLIParser, rawLogStdoutWriter io.Writer,
	taskCloser CLITaskCloser, command string, args ...string) error {
	taskLogger.INFO("ID [%s] exec: %s %s", taskCloser.TaskID(), command, strings.Join(args, " "))

	//exec cmd and analyze response from stdout & stderr
	execSyncCmd := exec.Command(command, args...)
	stdout, _ := execSyncCmd.StdoutPipe()
	defer stdout.Close()
	stderr, _ := execSyncCmd.StderrPipe()
	defer stderr.Close()

	syncCommand := &SyncCommand{
		Command:    execSyncCmd,
		TaskCloser: taskCloser,
		Docker:     command == "docker",
	}
	acd.mutex.Lock()
	acd.commands[taskCloser.TaskID()] = syncCommand
	acd.mutex.Unlock()

	defer func() {
		acd.mutex.Lock()
		delete(acd.commands, taskCloser.TaskID())
		acd.mutex.Unlock()
	}()

	err := execSyncCmd.Start()
	if err != nil {
		return err
	}

	var wg sync.WaitGroup
	var parsingErr error

	//writing result (airbyte/singer writes result to stdout)
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				logging.Error("panic in cli task")
				logging.Error(string(debug.Stack()))
				killErr := syncCommand.Kill(fmt.Sprintf("%v. Process will be killed", r))
				if killErr != nil {
					taskLogger.ERROR("Error killing process: %v", killErr)
					logging.Errorf("[%s] error killing process: %v", taskCloser.TaskID(), killErr)
				}
				return
			}
		}()

		parsingErr = cliParser.Parse(stdout)
		if parsingErr != nil {
			killErr := syncCommand.Kill(fmt.Sprintf("Parse output error: %v. Process will be killed", parsingErr))
			if killErr != nil {
				taskLogger.ERROR("Error killing process: %v", killErr)
				logging.Errorf("[%s] error killing process: %v", taskCloser.TaskID(), killErr)
			}
		}
	})

	dualWriter := logging.Dual{FileWriter: taskLogger, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", acd.sourceID), rawLogStdoutWriter)}

	//writing process logs (singer/airbyte writes process logs to stderr)
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(dualWriter, stderr)
	})

	wg.Wait()

	err = execSyncCmd.Wait()
	if err != nil {
		return err
	}

	if parsingErr != nil {
		return parsingErr
	}

	return nil
}

//Ready returns CLI Driver ready flag. Should be overridden in every implementation
func (acd *AbstractCLIDriver) Ready() (bool, error) {
	return false, errors.New("Unsupported in AbstractCLIDriver")
}

//GetTableNamePrefix returns stream table name prefix or sourceID_
func (acd *AbstractCLIDriver) GetTableNamePrefix() string {
	//put as prefix + stream if prefix exist
	if acd.tableNamePrefix != "" {
		return acd.tableNamePrefix
	}

	return acd.sourceID + "_"
}

func (acd *AbstractCLIDriver) GetTap() string {
	return acd.tap
}

//GetCollectionTable unsupported
func (acd *AbstractCLIDriver) GetCollectionTable() string {
	return ""
}

func (acd *AbstractCLIDriver) GetCollectionMetaKey() string {
	return acd.tap
}

//GetAllAvailableIntervals unsupported
func (acd *AbstractCLIDriver) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return nil, fmt.Errorf("%s driver doesn't support GetAllAvailableIntervals() func", acd.Type())
}

//GetObjectsFor unsupported
func (acd *AbstractCLIDriver) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	return nil, fmt.Errorf("%s driver doesn't support GetObjectsFor() func", acd.Type())
}

//Type returns CLI Driver type. Should be overridden in every implementation
func (acd *AbstractCLIDriver) Type() string {
	return "AbstractCLIDriver"
}

//IsClosed returns true if driver is closed
func (acd *AbstractCLIDriver) IsClosed() bool {
	return acd.closed.Load()
}

//Close kills all commands and returns errors if occurred
func (acd *AbstractCLIDriver) Close() (multiErr error) {
	acd.closed.Store(true)

	acd.mutex.Lock()
	for _, syncCommand := range acd.commands {
		logging.Infof("[%s] killing process: %s", acd.sourceID, syncCommand.Command.String())
		if err := syncCommand.Shutdown(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error killing %s sync command: %v", acd.sourceID, acd.Type(), err))
		}
	}

	acd.mutex.Unlock()

	return multiErr
}
