package singer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/uuid"
	"go.uber.org/atomic"
	"io"
	"io/ioutil"
	"os/exec"
	"path"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

const (
	stateFileName      = "state.json"
	configFileName     = "config.json"
	catalogFileName    = "catalog.json"
	propertiesFileName = "properties.json"
)

var (
	blacklistStreamsByTap = map[string]map[string]bool{
		"tap-slack": {
			"messages": true,
		},
	}

	errNotReady = errors.New("Singer driver isn't ready yet. Tap is being installed..")
)

type Singer struct {
	sync.RWMutex
	commands map[string]*exec.Cmd

	ctx            context.Context
	sourceID       string
	tap            string
	configPath     string
	catalogPath    string
	propertiesPath string
	statePath      string

	pathToConfigs    string
	tableNamePrefix  string
	streamTableNames map[string]string

	catalogDiscovered *atomic.Bool
	closed            *atomic.Bool
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
	config := &SingerConfig{}
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
	configPath, err := parseJSONAsFile(path.Join(pathToConfigs, configFileName), config.Config)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer config [%v]: %v", config.Config, err)
	}

	//parse singer catalog as file path
	catalogPath, err := parseJSONAsFile(path.Join(pathToConfigs, catalogFileName), config.Catalog)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer catalog [%v]: %v", config.Catalog, err)
	}

	// ** Table names mapping **
	tableNameMappings := config.StreamTableNames
	if catalogPath != "" {
		//extract table names mapping from catalog.json
		tableNameMappingsFromCatalog, err := extractTableNamesMapping(catalogPath)
		if err != nil {
			logging.Errorf("[%s] Error parsing destination table names from Singer catalog.json: %v", sourceConfig.SourceID, err)
		}
		//override configuration
		for stream, tableName := range tableNameMappingsFromCatalog {
			tableNameMappings[stream] = tableName
		}
	}

	if len(tableNameMappings) > 0 {
		b, _ := json.MarshalIndent(tableNameMappings, "", "    ")
		logging.Infof("[%s] configured Singer stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	//parse singer properties as file path
	propertiesPath, err := parseJSONAsFile(path.Join(pathToConfigs, propertiesFileName), config.Properties)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer properties [%v]: %v", config.Properties, err)
	}

	//parse singer state as file path
	statePath, err := parseJSONAsFile(path.Join(pathToConfigs, stateFileName), config.InitialState)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer initial state [%v]: %v", config.InitialState, err)
	}

	catalogDiscovered := atomic.NewBool(false)
	if catalogPath != "" || propertiesPath != "" {
		catalogDiscovered.Store(true)
	}

	s := &Singer{
		ctx:               ctx,
		commands:          map[string]*exec.Cmd{},
		sourceID:          sourceConfig.SourceID,
		tap:               config.Tap,
		configPath:        configPath,
		catalogPath:       catalogPath,
		propertiesPath:    propertiesPath,
		statePath:         statePath,
		tableNamePrefix:   config.StreamTableNamesPrefix,
		pathToConfigs:     pathToConfigs,
		streamTableNames:  tableNameMappings,
		catalogDiscovered: catalogDiscovered,
		closed:            atomic.NewBool(false),
	}

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

	ready, _ := singerDriver.Ready()
	if !ready {
		return nil
	}

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()

	command := path.Join(singer.Instance.VenvDir, singerDriver.tap, "bin", singerDriver.tap)

	err = singer.Instance.ExecCmd(command, outWriter, errWriter, "-c", singerDriver.configPath, "--discover")
	if err != nil {
		return fmt.Errorf("Error singer --discover: %v. %s", err, errWriter.String())
	}

	return nil
}

//EnsureTapAndCatalog ensures Singer tap via singer.Instance
// and does discover if catalog wasn't provided
func (s *Singer) EnsureTapAndCatalog() {
	singer.Instance.EnsureTap(s.tap)

	for {
		if s.closed.Load() {
			break
		}

		if s.catalogDiscovered.Load() {
			break
		}

		if !singer.Instance.IsTapReady(s.tap) {
			time.Sleep(time.Second)
			continue
		}

		catalogPath, propertiesPath, err := doDiscover(s.sourceID, s.tap, s.pathToConfigs, s.configPath)
		if err != nil {
			logging.Errorf("[%s] Error configuring Singer: %v", s.sourceID, err)
			time.Sleep(time.Minute)
			continue
		}

		s.catalogPath = catalogPath
		s.propertiesPath = propertiesPath

		s.catalogDiscovered.Store(true)
		return
	}
}

//GetTableNamePrefix returns stream table name prefix or sourceID_
func (s *Singer) GetTableNamePrefix() string {
	//put as prefix + stream if prefix exist
	if s.tableNamePrefix != "" {
		return s.tableNamePrefix
	}

	return s.sourceID + "_"
}

//GetCollectionTable unsupported
func (s *Singer) GetCollectionTable() string {
	return ""
}

func (s *Singer) GetCollectionMetaKey() string {
	return s.tap
}

//GetAllAvailableIntervals unsupported
func (s *Singer) GetAllAvailableIntervals() ([]*base.TimeInterval, error) {
	return nil, errors.New("Singer driver doesn't support GetAllAvailableIntervals() func. Please use SingerTask")
}

//GetObjectsFor unsupported
func (s *Singer) GetObjectsFor(interval *base.TimeInterval) ([]map[string]interface{}, error) {
	return nil, errors.New("Singer driver doesn't support GetObjectsFor() func. Please use SingerTask")
}

//Ready returns true if catalog is discovered and tap is installed
func (s *Singer) Ready() (bool, error) {
	if s.catalogDiscovered.Load() && singer.Instance.IsTapReady(s.tap) {
		return true, nil
	}

	return false, errNotReady
}

func (s *Singer) GetTap() string {
	return s.tap
}

func (s *Singer) Load(state string, taskLogger logging.TaskLogger, portionConsumer singer.PortionConsumer) error {
	if s.closed.Load() {
		return errors.New("Singer has already been closed")
	}

	ready, readyErr := s.Ready()
	if !ready {
		return readyErr
	}

	//update tap
	if err := singer.Instance.UpdateTap(s.tap); err != nil {
		return fmt.Errorf("Error updating singer tap [%s]: %v", s.tap, err)
	}

	//override initial state with existing one and put it to a file
	var statePath string
	var err error
	if state != "" {
		statePath, err = parseJSONAsFile(path.Join(singer.Instance.VenvDir, s.sourceID, s.tap, stateFileName), state)
		if err != nil {
			return fmt.Errorf("Error parsing singer state %s: %v", state, err)
		}
	} else {
		//put initial state
		statePath = s.statePath
	}

	args := []string{"-c", s.configPath}

	if s.catalogPath != "" {
		args = append(args, "--catalog", s.catalogPath)
	}

	if s.propertiesPath != "" {
		args = append(args, "-p", s.propertiesPath)
	}

	if statePath != "" {
		args = append(args, "--state", statePath)
	}

	command := path.Join(singer.Instance.VenvDir, s.tap, "bin", s.tap)

	taskLogger.INFO("exec singer %s %s", command, strings.Join(args, " "))

	//exec cmd and analyze response from stdout & stderr
	syncCmd := exec.Command(command, args...)
	stdout, _ := syncCmd.StdoutPipe()
	defer stdout.Close()
	stderr, _ := syncCmd.StderrPipe()
	defer stderr.Close()

	commandID := uuid.New()
	s.Lock()
	s.commands[commandID] = syncCmd
	s.Unlock()

	defer func() {
		s.Lock()
		delete(s.commands, commandID)
		s.Unlock()
	}()

	err = syncCmd.Start()
	if err != nil {
		return err
	}

	var wg sync.WaitGroup
	var parsingErr error

	//writing result (singer writes result to stdout)
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		defer func() {
			if r := recover(); r != nil {
				logging.Error("panic in singer task")
				logging.Error(string(debug.Stack()))
				s.logAndKill(taskLogger, syncCmd, r)
				return
			}
		}()

		parsingErr = singer.StreamParseOutput(stdout, portionConsumer, taskLogger)
		if parsingErr != nil {
			s.logAndKill(taskLogger, syncCmd, parsingErr)
		}
	})

	dualWriter := logging.Dual{FileWriter: taskLogger, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", s.sourceID), singer.Instance.LogWriter)}

	//writing process logs (singer writes process logs to stderr)
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(dualWriter, stderr)
	})

	wg.Wait()

	err = syncCmd.Wait()
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

func (s *Singer) Close() (multiErr error) {
	s.closed.Store(true)

	s.Lock()
	for _, command := range s.commands {
		logging.Infof("[%s] killing process: %s", s.sourceID, command.String())
		if err := command.Process.Kill(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error killing singer sync command: %v", s.sourceID, err))
		}
	}

	s.Unlock()

	return multiErr
}

func (s *Singer) GetStreamTableNameMapping() map[string]string {
	result := map[string]string{}
	for name, value := range s.streamTableNames {
		result[name] = value
	}

	return result
}

func (s *Singer) logAndKill(taskLogger logging.TaskLogger, syncCmd *exec.Cmd, parsingErr interface{}) {
	taskLogger.ERROR("Parse output error: %v. Process will be killed", parsingErr)
	logging.Errorf("[%s_%s] parse output error: %v. Process will be killed", s.sourceID, s.tap, parsingErr)

	killErr := syncCmd.Process.Kill()
	if killErr != nil {
		taskLogger.ERROR("Error killing process: %v", killErr)
		logging.Errorf("[%s_%s] error killing process: %v", s.sourceID, s.tap, killErr)
	}
}

//doDiscover discovers tap catalog and returns catalog and properties paths
//applies blacklist streams to taps and make other streams {"selected": true}
func doDiscover(sourceID, tap, pathToConfigs, configFilePath string) (string, string, error) {
	if !singer.Instance.IsTapReady(tap) {
		return "", "", errNotReady
	}

	outWriter := logging.NewStringWriter()
	errStrWriter := logging.NewStringWriter()
	dualStdErrWriter := logging.Dual{FileWriter: errStrWriter, Stdout: logging.NewPrefixDateTimeProxy(fmt.Sprintf("[%s]", sourceID), singer.Instance.LogWriter)}

	command := path.Join(singer.Instance.VenvDir, tap, "bin", tap)

	err := singer.Instance.ExecCmd(command, outWriter, dualStdErrWriter, "-c", configFilePath, "--discover")
	if err != nil {
		return "", "", fmt.Errorf("Error singer --discover: %v. %s", err, errStrWriter.String())
	}

	catalog := &SingerRawCatalog{}
	if err := json.Unmarshal(outWriter.Bytes(), &catalog); err != nil {
		return "", "", fmt.Errorf("Error unmarshalling catalog %s output: %v", outWriter.String(), err)
	}

	blackListStreams, ok := blacklistStreamsByTap[tap]
	if !ok {
		blackListStreams = map[string]bool{}
	}

	for _, stream := range catalog.Streams {
		streamName, ok := stream["stream"]
		if ok {
			if _, ok := blackListStreams[fmt.Sprint(streamName)]; ok {
				continue
			}
		} else {
			logging.Warnf("Stream [%v] doesn't have 'stream' name", stream)
		}

		//put selected=true into 'schema'
		schemaStruct, ok := stream["schema"]
		if !ok {
			return "", "", fmt.Errorf("Malformed discovered catalog structure %s: key 'schema' doesn't exist", outWriter.String())
		}
		schemaObj, ok := schemaStruct.(map[string]interface{})
		if !ok {
			return "", "", fmt.Errorf("Malformed discovered catalog structure %s: value under key 'schema' must be object: %T", outWriter.String(), schemaStruct)
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
	catalogPath, err := parseJSONAsFile(path.Join(pathToConfigs, catalogFileName), string(b))
	if err != nil {
		return "", "", fmt.Errorf("Error writing discovered singer catalog [%v]: %v", string(b), err)
	}

	//write singer properties as file path
	propertiesPath, err := parseJSONAsFile(path.Join(pathToConfigs, propertiesFileName), string(b))
	if err != nil {
		return "", "", fmt.Errorf("Error writing discovered singer properties [%v]: %v", string(b), err)
	}

	return catalogPath, propertiesPath, nil
}

//parse value and write it to a json file
//return path to created json file or return value if it is already path to json file
//or empty string if value is nil
func parseJSONAsFile(newPath string, value interface{}) (string, error) {
	if value == nil {
		return "", nil
	}

	switch value.(type) {
	case map[string]interface{}:
		payload := value.(map[string]interface{})
		b, err := json.Marshal(payload)
		if err != nil {
			return "", fmt.Errorf("Malformed value: %v", err)
		}

		return newPath, ioutil.WriteFile(newPath, b, 0644)
	case string:
		payload := value.(string)
		if strings.HasPrefix(payload, "{") {
			return newPath, ioutil.WriteFile(newPath, []byte(payload), 0644)
		}

		//already file
		return payload, nil
	default:
		return "", errors.New("Unknown type. Value must be path to json file or raw json")
	}
}

func extractTableNamesMapping(catalogPath string) (map[string]string, error) {
	catalogBytes, err := ioutil.ReadFile(catalogPath)
	if err != nil {
		return nil, fmt.Errorf("Error reading catalog file: %v", err)
	}

	catalog := &SingerCatalog{}
	err = json.Unmarshal(catalogBytes, catalog)
	if err != nil {
		return nil, err
	}

	streamTableNamesMapping := map[string]string{}

	for _, stream := range catalog.Streams {
		if stream.DestinationTableName != "" {
			//add mapping stream
			if stream.Stream != "" {
				streamTableNamesMapping[stream.Stream] = stream.DestinationTableName
			}
			//add mapping tap_stream_id
			if stream.TapStreamID != "" {
				streamTableNamesMapping[stream.TapStreamID] = stream.DestinationTableName
			}
		}
	}

	return streamTableNamesMapping, nil
}
