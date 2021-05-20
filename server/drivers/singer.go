package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/uuid"
	"io"
	"io/ioutil"
	"os/exec"
	"path"
	"strings"
	"sync"
)

const (
	stateFileName = "state.json"
)

var errNotReady = errors.New("Singer driver isn't ready yet. Tap is being installed..")

//SingerCatalog is a dto for Singer catalog serialization
type SingerCatalog struct {
	Streams []SingerStreamCatalog `json:"streams,omitempty"`
}

//SingerStreamCatalog is a dto for Singer catalog Stream object serialization
type SingerStreamCatalog struct {
	Stream               string `json:"stream,omitempty"`
	TapStreamID          string `json:"tap_stream_id,omitempty"`
	DestinationTableName string `json:"destination_table_name,omitempty"`
}

//SingerConfig is a dto for Singer configuration serialization
type SingerConfig struct {
	Tap              string            `mapstructure:"tap" json:"tap,omitempty" yaml:"tap,omitempty"`
	Config           interface{}       `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
	Catalog          interface{}       `mapstructure:"catalog" json:"catalog,omitempty" yaml:"catalog,omitempty"`
	Properties       interface{}       `mapstructure:"properties" json:"properties,omitempty" yaml:"properties,omitempty"`
	InitialState     interface{}       `mapstructure:"initial_state" json:"initial_state,omitempty" yaml:"initial_state,omitempty"`
	StreamTableNames map[string]string `mapstructure:"stream_table_names" json:"stream_table_names,omitempty" yaml:"stream_table_names,omitempty"`
}

//Validate returns err if configuration is invalid
func (sc *SingerConfig) Validate() error {
	if sc == nil {
		return errors.New("Singer config is required")
	}

	if sc.Tap == "" {
		return errors.New("Singer tap is required")
	}

	if sc.Config == nil {
		return errors.New("Singer config is required")
	}

	if sc.StreamTableNames == nil {
		sc.StreamTableNames = map[string]string{}
	}

	return nil
}

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

	streamTableNames map[string]string

	closed bool
}

func init() {
	if err := RegisterDriver(SingerType, NewSinger); err != nil {
		logging.Errorf("Failed to register driver %s: %v", SingerType, err)
	}
}

//NewSinger return Singer driver and
//1. write json files (config, catalog, properties, state) if string/raw json was provided
//2. create venv
//3. in another goroutine: update pip, install singer tap
func NewSinger(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &SingerConfig{}
	err := UnmarshalConfig(sourceConfig.Config, config)
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
	configPath, err := parseJSONAsFile(path.Join(pathToConfigs, "config.json"), config.Config)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer config [%v]: %v", config.Config, err)
	}

	//parse singer catalog as file path
	catalogPath, err := parseJSONAsFile(path.Join(pathToConfigs, "catalog.json"), config.Catalog)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer catalog [%v]: %v", config.Catalog, err)
	}

	// ** Table names mapping **
	tableNameMappings := config.StreamTableNames
	//extract table names mapping from catalog.json
	tableNameMappingsFromCatalog, err := extractTableNamesMapping(catalogPath)
	if err != nil {
		logging.Errorf("[%s] Error parsing destination table names from Singer catalog.json: %v", sourceConfig.SourceID, err)
	}
	//override configuration
	for stream, tableName := range tableNameMappingsFromCatalog {
		tableNameMappings[stream] = tableName
	}

	if len(tableNameMappings) > 0 {
		b, _ := json.MarshalIndent(tableNameMappings, "", "    ")
		logging.Infof("[%s] configured Singer stream - table names mapping: %s", sourceConfig.SourceID, string(b))
	}

	//parse singer properties as file path
	propertiesPath, err := parseJSONAsFile(path.Join(pathToConfigs, "properties.json"), config.Properties)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer properties [%v]: %v", config.Properties, err)
	}

	//parse singer state as file path
	statePath, err := parseJSONAsFile(path.Join(pathToConfigs, "state.json"), config.InitialState)
	if err != nil {
		return nil, fmt.Errorf("Error parsing singer initial state [%v]: %v", config.InitialState, err)
	}

	s := &Singer{
		ctx:              ctx,
		commands:         map[string]*exec.Cmd{},
		sourceID:         sourceConfig.SourceID,
		tap:              config.Tap,
		configPath:       configPath,
		catalogPath:      catalogPath,
		propertiesPath:   propertiesPath,
		statePath:        statePath,
		streamTableNames: tableNameMappings,
	}

	singer.Instance.EnsureTap(config.Tap)

	return s, nil
}

//GetCollectionTable unsupported
func (s *Singer) GetCollectionTable() string {
	return ""
}

//GetAllAvailableIntervals unsupported
func (s *Singer) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return nil, errors.New("Singer driver doesn't support GetAllAvailableIntervals() func. Please use SingerTask")
}

//GetObjectsFor unsupported
func (s *Singer) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	return nil, errors.New("Singer driver doesn't support GetObjectsFor() func. Please use SingerTask")
}

func (s *Singer) Ready() (bool, error) {
	if singer.Instance.IsTapReady(s.tap) {
		return true, nil
	}

	return false, errNotReady
}

func (s *Singer) GetTap() string {
	return s.tap
}

func (s *Singer) Load(state string, taskLogger logging.TaskLogger, portionConsumer singer.PortionConsumer) error {
	if s.closed {
		return errors.New("Singer has already been closed")
	}

	ready, readyErr := s.Ready()
	if !ready {
		return readyErr
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
		parsingErr = singer.StreamParseOutput(stdout, portionConsumer, taskLogger)
		if parsingErr != nil {
			taskLogger.ERROR("Parse output error: %v. Process will be killed", parsingErr)
			logging.Errorf("[%s_%s] parse output error: %v. Process will be killed", s.sourceID, s.tap, parsingErr)

			killErr := syncCmd.Process.Kill()
			if killErr != nil {
				taskLogger.ERROR("Error killing process: %v", killErr)
				logging.Errorf("[%s_%s] error killing process: %v", s.sourceID, s.tap, killErr)
			}
		}
	})

	//writing process logs (singer writes process logs to stderr)
	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(singer.Instance.LogWriter, stderr)
	})

	wg.Wait()

	err = syncCmd.Wait()
	if err != nil {
		return err
	}

	return nil
}

func (s *Singer) TestConnection() error {
	ready, notReadyError := s.Ready()
	if !ready {
		return notReadyError
	}

	outWriter := logging.NewStringWriter()
	errWriter := logging.NewStringWriter()

	command := path.Join(singer.Instance.VenvDir, s.tap, "bin", s.tap)

	err := singer.Instance.ExecCmd(command, outWriter, errWriter, "-c", s.configPath, "--discover")
	errStr := errWriter.String()
	if err != nil {
		return fmt.Errorf("Error singer --discover: %v. %s", err, errStr)
	}

	if errStr != "" {
		return fmt.Errorf("Error singer --dicsover: %s", errStr)
	}

	return nil
}

func (s *Singer) Type() string {
	return SingerType
}

func (s *Singer) Close() (multiErr error) {
	s.closed = true

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
