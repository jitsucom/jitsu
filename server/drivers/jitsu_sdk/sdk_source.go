package jitsu_sdk

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/utils"
	"sync"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/mitchellh/mapstructure"
	"go.uber.org/atomic"
	"strings"
)

var ErrSDKSourceCancelled = errors.New("Source runner was cancelled.")

const FullSyncChunkSize = 1000
const LatestVersion = "latest"
const IdField = "$id"
const RecordTimestampSrc = "$recordTimestamp"
const RecordTimestampDst = "_record_timestamp"

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

type DeleteRecords struct {
	PartitionTimestamp string `mapstructure:"partitionTimestamp" json:"partitionTimestamp,omitempty"`
	Granularity        string `mapstructure:"granularity" json:"granularity,omitempty"`
}

type Condition struct {
	Field  string      `mapstructure:"field" json:"field,omitempty"`
	Value  interface{} `mapstructure:"value" json:"value,omitempty"`
	Clause string      `mapstructure:"clause" json:"clause,omitempty"`
}

func init() {
	base.RegisterDriver(base.SdkSourceType, NewSdkSource)
	base.RegisterTestConnectionFunc(base.SdkSourceType, TestSdkSource)
	base.RegisterDriver(base.RedisType, func(ctx context.Context, sourceConfig *base.SourceConfig, collection *base.Collection) (base.Driver, error) {
		sourceConfig.Config["package_name"] = "jitsu-redis-source"
		sourceConfig.Config["package_version"] = "^0.7.4"
		collection.Type = "hash"
		return NewSdkSource(ctx, sourceConfig, collection)
	})
	base.RegisterTestConnectionFunc(base.RedisType, func(sourceConfig *base.SourceConfig) error {
		sourceConfig.Config["package_name"] = "jitsu-redis-source"
		sourceConfig.Config["package_version"] = "^0.7.4"
		return TestSdkSource(sourceConfig)
	})
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
	idParts := strings.Split(sourceConfig.SourceID, ".")
	abstract := base.NewAbstractCLIDriver(sourceConfig.SourceID, packageName, "", "", "", "",
		idParts[len(idParts)-1]+"_", "",
		map[string]string{collection.Name: collection.TableName})
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
	sdkSourceRunner := SdkSourceRunner{name: s.packageName, sourceExecutor: sourceExecutor, config: s.config, collection: s.collection, startTime: timestamp.Now(), closed: atomic.NewBool(false)}
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

	return sdkSourceRunner.Load(taskLogger, dataConsumer, state)
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
	startTime      time.Time
	closed         *atomic.Bool
}

func (s *SdkSourceRunner) Load(taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, state string) (err error) {
	if s.closed.Load() {
		return ErrSDKSourceCancelled
	}

	stateObj := map[string]interface{}{}
	if state != "" {
		err = json.Unmarshal([]byte(state), &stateObj)
		if err != nil {
			return fmt.Errorf("Failed to unmarshal state object %s: %v", state, err)
		}
	}

	stream := s.collection
	taskLogger.INFO("Starting processing stream: %s of type: %s", stream.Name, stream.Type)
	var supportedModes []interface{}
	var typeSupported bool
	rawCat, err := s.sourceExecutor.Catalog()
	if err != nil {
		return fmt.Errorf("Failed to load source catalog: %v", err)
	}
	catArr, ok := rawCat.([]interface{})
	if !ok {
		return fmt.Errorf("Invalid type of source catalog: %T expected []interface{}", rawCat)
	}
	for _, c := range catArr {
		cat, ok := c.(map[string]interface{})
		if !ok {
			return fmt.Errorf("Invalid type of source catalog stream: %T expected map[string]interface{}", c)
		}
		if cat["type"] == stream.Type {
			typeSupported = true
			supportedModes, ok = cat["supportedModes"].([]interface{})
			if !ok {
				return fmt.Errorf("Invalid value of stream supportedModes: %v expected array of strings", cat["supportedModes"])
			}
			if len(supportedModes) > 1 && stream.SyncMode == "" {
				return fmt.Errorf("\"mode\" is required when stream supports multiple modes: %v", supportedModes)
			} else if len(supportedModes) == 1 && stream.SyncMode == "" {
				stream.SyncMode = supportedModes[0].(string)
			} else if !utils.ArrayContains(supportedModes, stream.SyncMode) {
				return fmt.Errorf("provided \"mode\": %s is not among supported by stream: %v", stream.SyncMode, supportedModes)
			}
		}
	}
	if !typeSupported {
		return fmt.Errorf("Stream type: %s is not supported by source", stream.Type)
	}
	taskLogger.INFO("Sync mode selected: %s of supported %v", stream.SyncMode, supportedModes)

	chunkNumber := 0
	var currentChunk *base.CLIOutputRepresentation

	dataChannel := make(scriptListener, 1000)

	defer func() {
		if err != nil {
			dataConsumer.CleanupAfterError(currentChunk)
		}
	}()
	go func() {
		defer close(dataChannel)
		_, err := s.sourceExecutor.Stream(stream.Type, stream, stateObj, dataChannel)
		if err != nil {
			dataChannel <- err
		}
	}()
	fullSync := stream.SyncMode == "full_sync"
	recordCounter := 0
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
				currentChunk, chunkNumber, err = s.GetOrRotateChunk(taskLogger, dataConsumer, currentChunk, chunkNumber, fullSync && recordCounter > 0 && recordCounter%FullSyncChunkSize == 0, false)
				if err != nil {
					return err
				}
				object, ok := row.Message.(map[string]interface{})
				if !ok {
					return fmt.Errorf("Record message expected to have type map[string]interface{} found: %T", row.Message)
				}
				id, ok := object[IdField]
				if ok && currentChunk.CurrentStream().KeyFields == nil && fmt.Sprint(id) != "" {
					currentChunk.CurrentStream().KeyFields = []string{IdField}
				}
				ts, ok := object[RecordTimestampSrc]
				if ok {
					object[RecordTimestampDst] = ts
					delete(object, RecordTimestampSrc)
				}
				currentChunk.CurrentStream().Objects = append(currentChunk.CurrentStream().Objects, object)
				recordCounter++
			case "delete_records":
				if fullSync {
					return fmt.Errorf("Delete records message is not allowed in full_sync mode")
				}
				currentChunk, chunkNumber, err = s.GetOrRotateChunk(taskLogger, dataConsumer, currentChunk, chunkNumber, false, false)
				if err != nil {
					return err
				}
				if len(currentChunk.CurrentStream().Objects) > 0 {
					return fmt.Errorf("\"delete_records\" message must precede any \"record\" message in transaction. Current added records number: %d", len(currentChunk.CurrentStream().Objects))
				}
				deleteRecords := DeleteRecords{}
				err = mapstructure.Decode(row.Message, &deleteRecords)
				if err != nil {
					return fmt.Errorf("Failed to parse delete_records message %s, %v", row.Message, err)
				}
				deleteConditions := base.DeleteConditions{}
				if deleteRecords.Granularity != "" {
					partitionTimestamp, err := time.Parse(time.RFC3339Nano, deleteRecords.PartitionTimestamp)
					if err != nil {
						return fmt.Errorf("Failed to parse partitionTimestamp from %s: %v", deleteRecords.PartitionTimestamp, err)

					}
					granularity := schema.Granularity(deleteRecords.Granularity)
					deleteConditions.Partition = base.DatePartition{Field: RecordTimestampDst, Value: partitionTimestamp, Granularity: granularity}
					deleteConditions.JoinCondition = "AND"
					deleteConditions.Conditions = append(deleteConditions.Conditions, base.DeleteCondition{Field: RecordTimestampDst, Value: granularity.Lower(partitionTimestamp), Clause: ">="})
					deleteConditions.Conditions = append(deleteConditions.Conditions, base.DeleteCondition{Field: RecordTimestampDst, Value: granularity.Upper(partitionTimestamp), Clause: "<="})
					taskLogger.INFO("Delete Records: partitionTimestamp: %s + granularity: %s", deleteRecords.PartitionTimestamp, deleteRecords.Granularity)
				}
				currentChunk.CurrentStream().DeleteConditions = &deleteConditions
			case "clear_stream":
				if fullSync {
					return fmt.Errorf("Clear stream message is not allowed in full_sync mode")
				}
				currentChunk, chunkNumber, err = s.GetOrRotateChunk(taskLogger, dataConsumer, currentChunk, chunkNumber, false, false)
				if err != nil {
					return err
				}
				if chunkNumber == 0 && len(currentChunk.CurrentStream().Objects) > 0 {
					return fmt.Errorf("\"clear_stream\" message allowed only in the zero chunk and before any \"record\" message added. Current chunk number: %d Current chunk added records number: %d", chunkNumber, len(currentChunk.CurrentStream().Objects))
				}
				taskLogger.INFO("Table %s will be cleared", stream.TableName)
				currentChunk.CurrentStream().NeedClean = true
			case "new_transaction":
				if fullSync {
					return fmt.Errorf("New transaction message is not allowed in full_sync mode")
				}
				currentChunk, chunkNumber, err = s.GetOrRotateChunk(taskLogger, dataConsumer, currentChunk, chunkNumber, true, false)
				if err != nil {
					return err
				}
				taskLogger.INFO("New transaction for chunk number: %d", chunkNumber)
			case "state":
				taskLogger.INFO("State changed: %+v", row.Message)
				currentChunk.State = row.Message
			case "log":
				log, ok := row.Message.(map[string]interface{})
				if !ok {
					taskLogger.ERROR("Log message expected to have type map[string]interface{} found: %T", row.Message)
				}
				taskLogger.LOG(strings.ReplaceAll(log["message"].(string), "%", "%%"), "Jitsu", logging.ToLevel(log["level"].(string)))
			default:
				taskLogger.ERROR("Message type %s is not supported yet.", row.Type)
			}
		case error:
			return data
		default:
			taskLogger.ERROR("Failed to parse message from source: %+v of type: %T", data, data)
		}

	}

	if !s.closed.Load() {
		//rotate chunk to consume the last one
		_, _, err := s.GetOrRotateChunk(taskLogger, dataConsumer, currentChunk, chunkNumber, true, true)
		return err
	} else {
		taskLogger.WARN("Stopping processing. Task was closed")
		return ErrSDKSourceCancelled
	}
}

func (s SdkSourceRunner) GetOrRotateChunk(taskLogger logging.TaskLogger, dataConsumer base.CLIDataConsumer, currentChunk *base.CLIOutputRepresentation, chunkNumber int, forceCreate bool, finalChunk bool) (newChunk *base.CLIOutputRepresentation, newChunkNumber int, err error) {
	stream := s.collection
	exists := currentChunk != nil
	if !exists || forceCreate {
		newChunkNumber = chunkNumber
		if exists && forceCreate {
			if stream.SyncMode == "full_sync" {
				if chunkNumber == 0 && currentChunk.CurrentStream().NeedClean == false {
					//taskLogger.INFO("Stream: %s No clear_stream was received for stream in \"full_sync\" mode. Forcing cleaning table", stream.Name)
					currentChunk.CurrentStream().NeedClean = true
				}
			}
			taskLogger.INFO("Chunk: %s_%d finished. Objects count: %d", stream.Name, chunkNumber, len(currentChunk.CurrentStream().Objects))
			if stream.SyncMode == "full_sync" && finalChunk {
				currentChunk.CurrentStream().SwapWithIntermediateTable = true
			}
			err = dataConsumer.Consume(currentChunk)
			if err != nil {
				return currentChunk, chunkNumber, err
			}
			//we create next chunk when some chunks already present. increment chunk number
			newChunkNumber = chunkNumber + 1
		}
		name := stream.Name
		intermediateTableName := ""
		if stream.SyncMode == "full_sync" {
			intermediateTableName = fmt.Sprintf("%s_tmp_%s", stream.Name, s.startTime.Format("060102_150405"))
		}
		newChunk = base.NewCLIOutputRepresentation()
		newChunk.AddStream(stream.Name, &base.StreamRepresentation{
			StreamName:            name,
			IntermediateTableName: intermediateTableName,
			BatchHeader:           &schema.BatchHeader{TableName: stream.TableName, Fields: map[string]schema.Field{}},
			Objects:               []map[string]interface{}{},
			KeepKeysUnhashed:      true,
			RemoveSourceKeyFields: true,
		})
		return
	} else {
		return currentChunk, chunkNumber, nil
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
