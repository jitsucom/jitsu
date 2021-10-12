package singer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/runner"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/singer"
	"go.uber.org/atomic"
	"io"
	"os/exec"
	"path"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

const syncTimeout = time.Hour * 24

var (
	blacklistStreamsByTap = map[string]map[string]bool{
		"tap-slack": {
			"messages": true,
		},
	}
)

//Singer is a Singer CLI driver
type Singer struct {
	base.AbstractCLIDriver

	mutex              *sync.RWMutex
	activeSyncCommands map[string]*SyncCommand

	pathToConfigs     string
	streamReplication map[string]string
	catalogDiscovered *atomic.Bool

	discoverCatalogLastError error

	closed chan struct{}
}

func init() {
	base.RegisterDriver(base.SingerType, NewSinger)
	base.RegisterTestConnectionFunc(base.SingerType, TestSinger)
}

//NewSinger returns Singer driver and
//1. writes json files (config, catalog, properties, state) if string/raw json was provided
//2. runs discover and collects catalog.json
//2. creates venv
//3. in another goroutine: updates pip, install singer tap
func NewSinger(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
	config := &Config{}
	err := base.UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if err := config.Validate(); err != nil {
		return nil, err
	}

	if singer.Instance == nil {
		return nil, errors.New("singer-bridge must be configured")
	}

	pathToConfigs := path.Join(singer.Instance.VenvDir, sourceConfig.SourceID, config.Tap)
	if err := logging.EnsureDir(pathToConfigs); err != nil {
		return nil, fmt.Errorf("Error creating singer venv config dir: %v", err)
	}

	//parse singer config as file path
	configPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.ConfigFileName), config.Config)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer config [%v]: %v", config.Config, err)
	}

	//parse singer catalog as file path
	catalogPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.CatalogFileName), config.Catalog)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer catalog [%v]: %v", config.Catalog, err)
	}

	//parse singer properties as file path
	propertiesPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.PropertiesFileName), config.Properties)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer properties [%v]: %v", config.Properties, err)
	}

	extractor, err := NewFileBasedSingerSettingsExtractor(catalogPath, propertiesPath)
	if err != nil {
		return nil, err
	}
	prefix := config.StreamTableNamesPrefix
	if prefix == "" {
		prefix = sourceConfig.SourceID + "_"
	}
	// ** Table names mapping **
	tableNameMappings := config.StreamTableNames
	//extract table names mapping from catalog.json
	if tableNameMappingsFromCatalog, err := extractor.ExtractTableNamesMappings(prefix); err != nil {
		logging.Errorf("[%s] Error parsing destination table names from Singer catalog.json: %v", sourceConfig.SourceID, err)
	} else if len(tableNameMappingsFromCatalog) > 0 {
		//override configuration
		for stream, tableName := range tableNameMappingsFromCatalog {
			tableNameMappings[stream] = tableName
		}
	}

	if len(tableNameMappings) > 0 {
		b, _ := json.MarshalIndent(tableNameMappings, "", "    ")
		logging.Infof("[%s] configured Singer stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	streamReplicationMappings, err := extractor.ExtractStreamReplicationMappings()
	if err != nil {
		logging.Errorf("[%s] Error extracting replication method for each stream: %v", sourceConfig.SourceID, err)
	} else {
		b, _ := json.MarshalIndent(streamReplicationMappings, "", "    ")
		logging.Infof("[%s] configured Singer stream - replication method mappings: %s", sourceConfig.SourceID, string(b))
	}

	//parse singer state as file path
	statePath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.StateFileName), config.InitialState)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer initial state [%v]: %v", config.InitialState, err)
	}

	catalogDiscovered := atomic.NewBool(false)
	if catalogPath != "" || propertiesPath != "" {
		catalogDiscovered.Store(true)
	}

	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, config.Tap, configPath, catalogPath, propertiesPath, statePath,
		config.StreamTableNamesPrefix, pathToConfigs, config.StreamTableNames)

	s := &Singer{
		mutex:              &sync.RWMutex{},
		activeSyncCommands: map[string]*SyncCommand{},

		pathToConfigs:     pathToConfigs,
		streamReplication: streamReplicationMappings,
		catalogDiscovered: catalogDiscovered,

		closed: make(chan struct{}),
	}

	s.AbstractCLIDriver = *abstract

	safego.Run(s.EnsureTapAndCatalog)

	return s, nil
}

//TestSinger tests singer connection (runs discover) if tap has been installed otherwise returns nil
func TestSinger(sourceConfig *base.SourceConfig) error {
	driver, err := NewSinger(context.Background(), sourceConfig, nil)
	if err != nil {
		return err
	}
	defer driver.Close()

	singerDriver, _ := driver.(*Singer)

	ready, err := singerDriver.Ready()
	if !ready {
		return err
	}

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()

	command := path.Join(singer.Instance.VenvDir, singerDriver.GetTap(), "bin", singerDriver.GetTap())
	args := []string{"-c", singerDriver.GetConfigPath(), "--discover"}

	err = runner.ExecCmd(base.SingerType, command, outWriter, errWriter, time.Second*50, args...)
	if err != nil {
		return fmt.Errorf("Error singer --discover: %v. %s", err, errWriter.String())
	}

	return nil
}

//EnsureTapAndCatalog ensures Singer tap via singer.Instance
// and does discover if catalog wasn't provided
func (s *Singer) EnsureTapAndCatalog() {
	singer.Instance.EnsureTap(s.GetTap())
	retry := 0

	for {
		if s.IsClosed() {
			break
		}

		if s.catalogDiscovered.Load() {
			break
		}

		if ready, _ := singer.Instance.IsTapReady(s.GetTap()); !ready {
			time.Sleep(time.Second)
			continue
		}

		catalogPath, propertiesPath, streamNames, err := doDiscover(s.ID(), s.GetTap(), s.pathToConfigs, s.GetConfigPath())
		if err != nil {
			s.mutex.Lock()
			s.discoverCatalogLastError = err
			s.mutex.Unlock()

			retry++
			logging.Errorf("[%s] Error configuring Singer: %v. Scheduled next try after: %d minutes", s.ID(), err, retry)
			time.Sleep(time.Duration(retry) * time.Minute)
			continue
		}

		streamTableNameMapping := map[string]string{}
		for _, streamName := range streamNames {
			streamTableNameMapping[streamName] = s.GetTableNamePrefix() + streamName
		}

		s.mutex.Lock()
		s.discoverCatalogLastError = nil
		s.mutex.Unlock()

		s.SetStreamTableNameMappingIfNotExists(streamTableNameMapping)
		s.SetCatalogPath(catalogPath)
		s.SetPropertiesPath(propertiesPath)

		s.catalogDiscovered.Store(true)
		return
	}
}

//Ready returns true if catalog is discovered and tap is installed
func (s *Singer) Ready() (bool, error) {
	ready, err := singer.Instance.IsTapReady(s.GetTap())
	if !ready {
		if err != nil {
			return false, runner.NewCompositeNotReadyError(err.Error())
		}

		return false, runner.ErrNotReady
	}

	//check catalog after tap because catalog can be configured and discovered by user
	if s.catalogDiscovered.Load() {
		return true, nil
	}

	s.mutex.RLock()
	defer s.mutex.RUnlock()
	msg := ""
	if s.discoverCatalogLastError != nil {
		msg = s.discoverCatalogLastError.Error()
	}

	return false, runner.NewCompositeNotReadyError(msg)
}

func (s *Singer) Load(state string, taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, taskCloser base.CLITaskCloser) error {
	if s.IsClosed() {
		return fmt.Errorf("%s has already been closed", s.Type())
	}

	//waiting when singer is ready
	ready, readyErr := base.WaitReadiness(s, taskLogger)
	if !ready {
		return readyErr
	}

	//update tap
	if err := singer.Instance.UpdateTap(s.GetTap()); err != nil {
		return fmt.Errorf("Error updating singer tap [%s]: %v", s.GetTap(), err)
	}

	statePath, err := s.GetStateFilePath(state)
	if err != nil {
		return err
	}

	args := []string{"-c", s.GetConfigPath()}

	if s.GetCatalogPath() != "" {
		args = append(args, "--catalog", s.GetCatalogPath())
	}

	if s.GetPropertiesPath() != "" {
		args = append(args, "-p", s.GetPropertiesPath())
	}

	if statePath != "" {
		args = append(args, "--state", statePath)
	}

	command := path.Join(singer.Instance.VenvDir, s.GetTap(), "bin", s.GetTap())

	sop := &streamOutputParser{
		dataConsumer:      dataConsumer,
		streamReplication: s.streamReplication,
		logger:            taskLogger,
	}

	return s.loadAndParse(taskLogger, sop, singer.Instance.LogWriter, taskCloser, command, args...)
}

func (s *Singer) loadAndParse(taskLogger logging.TaskLogger, cliParser base.CLIParser, rawLogStdoutWriter io.Writer,
	taskCloser base.CLITaskCloser, command string, args ...string) error {
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
	}
	s.mutex.Lock()
	s.activeSyncCommands[taskCloser.TaskID()] = syncCommand
	s.mutex.Unlock()

	defer func() {
		s.mutex.Lock()
		delete(s.activeSyncCommands, taskCloser.TaskID())
		s.mutex.Unlock()
	}()

	commandFinished := make(chan struct{})
	defer close(commandFinished)
	//close command by timeout
	safego.Run(func() {
		ticker := time.NewTicker(syncTimeout)
		for {
			select {
			case <-s.closed:
				return
			case <-commandFinished:
				return
			case <-ticker.C:
				logging.Warnf("[%s] Singer sync run timeout after [%s]", s.ID(), syncTimeout.String())

				if err := syncCommand.Command.Process.Kill(); err != nil {
					logging.SystemErrorf("Error terminating Singer command %s: %v", syncCommand.Command.String(), err)
				}

				s.mutex.Lock()
				delete(s.activeSyncCommands, taskCloser.TaskID())
				s.mutex.Unlock()
			}
		}
	})

	err := execSyncCmd.Start()
	if err != nil {
		return err
	}

	var wg sync.WaitGroup
	var parsingErr error

	//writing result singer writes result to stdout
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				logging.Error("panic in singer task")
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

	dualWriter := logging.Dual{FileWriter: taskLogger, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", s.ID()), rawLogStdoutWriter)}

	//writing process logs singer to stderr
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

func (s *Singer) Type() string {
	return base.SingerType
}

//Close kills all commands and returns errors if occurred
func (s *Singer) Close() (multiErr error) {
	if s.IsClosed() {
		return nil
	}

	s.mutex.Lock()
	for _, command := range s.activeSyncCommands {
		logging.Infof("[%s] killing process: %s", s.ID(), command.Command.String())
		if err := command.Shutdown(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error killing singer sync command: %v", s.ID(), err))
		}
	}

	s.mutex.Unlock()

	return multiErr
}

func (s *Singer) IsClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

//doDiscover discovers tap catalog and returns catalog and properties paths
//applies blacklist streams to taps and make other streams {"selected": true}
func doDiscover(sourceID, tap, pathToConfigs, configFilePath string) (string, string, []string, error) {
	outWriter := logging.NewStringWriter()
	errStrWriter := logging.NewStringWriter()
	dualStdErrWriter := logging.Dual{FileWriter: errStrWriter, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", sourceID), singer.Instance.LogWriter)}

	command := path.Join(singer.Instance.VenvDir, tap, "bin", tap)
	args := []string{"-c", configFilePath, "--discover"}

	err := runner.ExecCmd(base.SingerType, command, outWriter, dualStdErrWriter, time.Minute*10, args...)
	if err != nil {
		return "", "", nil, fmt.Errorf("Error singer --discover: %v. %s", err, errStrWriter.String())
	}

	catalog := &RawCatalog{}
	if err := json.Unmarshal(outWriter.Bytes(), &catalog); err != nil {
		return "", "", nil, fmt.Errorf("Error unmarshalling catalog %s output: %v", outWriter.String(), err)
	}

	blackListStreams, ok := blacklistStreamsByTap[tap]
	if !ok {
		blackListStreams = map[string]bool{}
	}

	var streamNames []string

	for _, stream := range catalog.Streams {
		streamName, ok := stream["stream"]
		if ok {
			streamNameStr := fmt.Sprint(streamName)
			streamNames = append(streamNames, streamNameStr)
			if _, ok := blackListStreams[streamNameStr]; ok {
				continue
			}
		} else {
			logging.Warnf("Stream [%v] doesn't have 'stream' name", stream)
		}

		//put selected=true into 'schema'
		schemaStruct, ok := stream["schema"]
		if !ok {
			return "", "", nil, fmt.Errorf("Malformed discovered catalog structure %s: key 'schema' doesn't exist", outWriter.String())
		}
		schemaObj, ok := schemaStruct.(map[string]interface{})
		if !ok {
			return "", "", nil, fmt.Errorf("Malformed discovered catalog structure %s: value under key 'schema' must be object: %T", outWriter.String(), schemaStruct)
		}

		schemaObj["selected"] = true

		//put selected=true into every 'metadata' object
		metadataArrayIface, ok := stream["metadata"]
		if ok {
			metadataArray, ok := metadataArrayIface.([]interface{})
			if ok {
				for _, metadata := range metadataArray {
					metadataObj, ok := metadata.(map[string]interface{})
					if ok {
						innerMetadata, ok := metadataObj["metadata"]
						if ok {
							innerMetadataObj, ok := innerMetadata.(map[string]interface{})
							if ok {
								innerMetadataObj["selected"] = true
							}
						}
					}
				}
			}
		}
	}

	b, _ := json.MarshalIndent(catalog, "", "    ")

	//write singer catalog as file path
	catalogPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.CatalogFileName), string(b))
	if err != nil {
		return "", "", nil, fmt.Errorf("Error writing discovered singer catalog [%v]: %v", string(b), err)
	}

	//write singer properties as file path
	propertiesPath, err := parsers.ParseJSONAsFile(path.Join(pathToConfigs, base.PropertiesFileName), string(b))
	if err != nil {
		return "", "", nil, fmt.Errorf("Error writing discovered singer properties [%v]: %v", string(b), err)
	}

	return catalogPath, propertiesPath, streamNames, nil
}
