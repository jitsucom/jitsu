package bulkerlib

import (
	"context"
	"fmt"
	"io"
	"reflect"
	"strconv"
	"strings"

	"github.com/jitsucom/bulker/bulkerlib/types"
	types2 "github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type InitFunction func(Config) (Bulker, error)

// BulkerRegistry registry of init functions for bulker implementations. Used By CreateBulker factory method
var BulkerRegistry = make(map[string]InitFunction)
var ColumnNameCache = map[string]*utils.SyncMapCache[ColumnName]{} //cache for column names by bulker type

type BulkMode string

const (
	//Stream - bulker stream immediately commits each consumed object to the database
	//Useful when working with live stream of objects
	Stream BulkMode = "stream"

	//Batch - bulker stream commits all consumed object on Complete call
	//Useful when working with large number of objects or to optimize performance or costs using batch processing
	//Any error with just one object will fail the whole transaction and no objects will be written to the database
	Batch BulkMode = "batch"

	//ReplacePartition stream replaces all rows associated with the chosen partition column value in a single transaction (where applicable).
	//It is useful when it is required to reprocess all objects associates with specific partition id.
	//E.g. for processing and reprocessing one day of reporting data
	//If data of your stream may be reprocessed in some point in time it is recommended to always use ReplacePartition mode for that stream
	//
	//ReplacePartition implies Batch, meaning that the new data will be available only after BulkerStream.complete() call
	ReplacePartition BulkMode = "replace_partition"

	//ReplaceTable - atomically replaces target table with a new one filled with the object injected to current stream.
	//To sync entire collection of objects at once without leaving target table in unfinished state
	//Useful when collection contains finite number of object, and when it is required that target table always represent complete state for some point of time.
	//
	//ReplaceTable implies Batch, meaning that the new data will be available only after BulkerStream.complete() call
	ReplaceTable BulkMode = "replace_table"

	Unknown BulkMode = ""

	BatchNumberCtxKey = "batch_number"
	// BatchSuffixCtxKey carries a text suffix for the name of a batch object, for writers that are not the bulker app's batch
	// consumer (the sync sidecar). It lives apart from BatchNumberCtxKey so the two can never produce the same object name.
	BatchSuffixCtxKey = "batch_suffix"
)

// TODO: Recommend to use JSON Number! or let all column be float?

// Bulker interface allows streaming object to data warehouses using different modes.
// See BulkMode for more details.
type Bulker interface {
	io.Closer
	// CreateStream create a BulkerStream instance that will store objects to the target table in a data warehouse.
	// bulker BulkerStream creates a new table with provided tableName if it does not exist.
	// Table schema is based on flattened object structure but may be overridden by providing WithTable option.
	// bulker BulkerStream will add new column to a table on the fly if new properties appear in object and table schema is not overridden.
	// TODO: escape special symbols in table names
	CreateStream(id, tableName string, mode BulkMode, streamOptions ...StreamOption) (BulkerStream, error)
	Type() string
}

type DummyBulker struct {
	Error error
}

func (d *DummyBulker) Type() string {
	return "dummy"
}

func (d *DummyBulker) Close() error {
	return nil
}

func (d *DummyBulker) CreateStream(id, tableName string, mode BulkMode, streamOptions ...StreamOption) (BulkerStream, error) {
	return nil, d.Error
}

// TODO: Commit() method that commits transaction and start new one ??
type BulkerStream interface {

	//Consume - put object to the stream. If stream is in Stream mode it will be immediately committed to the database.
	//Otherwise, it will be buffered and committed on Complete call.
	Consume(ctx context.Context, object types.Object) (state State, processedObject types.Object, err error)
	ConsumeJSON(ctx context.Context, json []byte) (state State, processedObject types.Object, err error)
	ConsumeMap(ctx context.Context, mp map[string]any) (state State, processedObject types.Object, err error)
	//Abort - abort stream and rollback all uncommitted objects. For stream in Stream mode does nothing.
	//Returns stream statistics. BulkerStream cannot be used after Abort call.
	Abort(ctx context.Context) State
	//Complete - commit all uncommitted objects to the database. For stream in Stream mode does nothing.
	//Returns stream statistics. BulkerStream cannot be used after Complete call.
	Complete(ctx context.Context) (State, error)

	//TODO: TestConnection
}

type Config struct {
	//id of Bulker instance for logging and metrics
	Id string `mapstructure:"id"  json:"id"`
	//bulkerType - type of bulker implementation will stream data to
	BulkerType string `mapstructure:"type" json:"type"`
	//destinationConfig - config of destination - may be struct type supported by destination implementation of map[string]any
	DestinationConfig any `mapstructure:"credentials" json:"credentials"`
	//TODO: think about logging approach for library
	LogLevel LogLevel `mapstructure:"logLevel,omitempty"`
}

type StreamConfig struct {
	TableName string `mapstructure:"defaultTableName" json:"defaultTableName"`
	//Options by option name (key) in serialized form
	Options map[string]any `mapstructure:"options" json:"options"`
}

type ColumnName struct {
	Unquoted   string
	UseQuoting bool
}

// RegisterBulker registers function to create new bulker instance
func RegisterBulker(bulkerType string, initFunc InitFunction) {
	BulkerRegistry[bulkerType] = initFunc
	ColumnNameCache[bulkerType] = utils.NewSyncMapCache[ColumnName](100000)
}

func CreateBulker(config Config) (Bulker, error) {
	initFunc, ok := BulkerRegistry[config.BulkerType]
	if !ok {
		return nil, fmt.Errorf("unknown bulker implementation type: %s", config.BulkerType)
	}
	return initFunc(config)
}

type Status string

const (
	//Completed - stream was completed successfully
	Completed Status = "COMPLETED"
	//Aborted - stream was aborted by user
	Aborted Status = "ABORTED"
	//Failed - failed to complete stream
	Failed Status = "FAILED"
	//Active - stream is active
	Active Status = "ACTIVE"
)

// State is used as a Batch storing result
type State struct {
	//Representation of message processing. For SQL warehouses it is table schema
	Representation    any            `json:"representation"`
	Status            Status         `json:"status"`
	Mode              BulkMode       `json:"mode"`
	LastError         error          `json:"-"`
	LastErrorText     string         `json:"error,omitempty"`
	ProcessedRows     int            `json:"processedRows"`
	ProcessedBytes    int            `json:"processedBytes"`
	SuccessfulRows    int            `json:"successfulRows"`
	ErrorRowIndex     int            `json:"errorRowIndex,omitempty"`
	ProcessingTimeSec float64        `json:"processingTimeSec"`
	WarehouseState    WarehouseState `json:"statistics,omitempty"`
	QueueSize         int            `json:"queueSize"`
}

type WarehouseState struct {
	Name            string                          `json:"name"`
	BytesProcessed  int                             `json:"bytesProcessed,omitempty"`
	TimeProcessedMs int64                           `json:"timeProcessedMs"`
	EstimatedCost   float64                         `json:"estimatedCost"`
	AdditionalInfo  map[string]any                  `json:",inline,omitempty"`
	States          *types2.OrderedMap[string, any] `json:"states,omitempty"`
}

var warehouseStateMergeF = func(curr, new any) any {
	c := curr.(WarehouseState)
	(&c).merge(new.(WarehouseState))
	return c
}

func (s *State) Merge(second State) {
	s.ProcessedRows += second.ProcessedRows
	s.ProcessedBytes += second.ProcessedBytes
	s.SuccessfulRows += second.SuccessfulRows
	s.ProcessingTimeSec += second.ProcessingTimeSec
	if second.WarehouseState.Name != "" {
		second.WarehouseState.States.ForEach(func(key string, value any) {
			s.AddWarehouseState(value.(WarehouseState))
		})
	}
}

func (s *State) PrintWarehouseState() string {
	// print non-zero values
	if s.WarehouseState.Name == "" {
		return ""
	}
	if s.WarehouseState.Name != "total" {
		return s.WarehouseState.String()
	}
	var sb strings.Builder
	sb.WriteString(s.WarehouseState.String())
	s.WarehouseState.States.ForEach(func(key string, value any) {
		sb.WriteRune(' ')
		c := value.(WarehouseState)
		sb.WriteString((&c).String())
	})
	return sb.String()
}

func (s *State) AddWarehouseState(ws WarehouseState) {
	if s.WarehouseState.Name == "" {
		s.WarehouseState = ws
	} else {
		s.WarehouseState.Merge(ws)
	}
}

func (ws *WarehouseState) String() string {
	str := ws.Name + ":" + strconv.FormatInt(ws.TimeProcessedMs, 10)
	if ws.EstimatedCost != 0 {
		str = str + ",$" + strconv.FormatFloat(ws.EstimatedCost, 'f', 3, 64)
	}
	return str
}

func (ws *WarehouseState) merge(second WarehouseState) {
	ws.Name = second.Name
	ws.BytesProcessed += second.BytesProcessed
	ws.TimeProcessedMs += second.TimeProcessedMs
	ws.EstimatedCost += second.EstimatedCost
	for k, v := range second.AdditionalInfo {
		ws.AdditionalInfo[k] = v
	}
}

func (ws *WarehouseState) Merge(second WarehouseState) {
	if second.Name == "" {
		return
	}
	if ws.Name == "" {
		*ws = second
		return
	}
	if ws.States == nil {
		st := *ws
		ws.States = types2.NewOrderedMap[string, any](0)
		ws.States.Set(ws.Name, st)
	}
	ws.Name = "total"
	ws.BytesProcessed += second.BytesProcessed
	ws.TimeProcessedMs += second.TimeProcessedMs
	ws.EstimatedCost += second.EstimatedCost
	for k, v := range second.AdditionalInfo {
		ws.AdditionalInfo[k] = v
	}
	if second.Name == "total" {
		ws.States.MergeAll(second.States, warehouseStateMergeF)
	} else {
		ws.States.Merge(second.Name, second, warehouseStateMergeF)
	}
}

// SetError sets error to the state
func (s *State) SetError(err error) {
	s.LastError = err
	s.LastErrorText = err.Error()
}

// to string
func (s *State) String() string {
	// print non-zero values
	var sb strings.Builder
	countersValue := reflect.ValueOf(*s)
	countersType := countersValue.Type()
	for i := 0; i < countersValue.NumField(); i++ {
		field := countersValue.Field(i)
		if !field.IsZero() {
			sb.WriteString(fmt.Sprintf("%s: %v ", countersType.Field(i).Name, field.Interface()))
		}
	}
	return sb.String()
}

type LogLevel int

const (
	Off LogLevel = iota
	Default
	Verbose
	Full
)
