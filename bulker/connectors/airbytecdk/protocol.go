package airbyte

import (
	"encoding/json"
	"errors"
	"io"
	"time"
)

// Should conform to https://github.com/airbytehq/airbyte/blob/master/airbyte-protocol/models/src/main/resources/airbyte_protocol/airbyte_protocol.yaml

type cmd string

const (
	cmdSpec     cmd = "spec"
	cmdCheck    cmd = "check"
	cmdDiscover cmd = "discover"
	cmdRead     cmd = "read"
)

type msgType string

const (
	msgTypeRecord         msgType = "RECORD"
	msgTypeState          msgType = "STATE"
	msgTypeLog            msgType = "LOG"
	msgTypeTrace          msgType = "TRACE"
	msgTypeConnectionStat msgType = "CONNECTION_STATUS"
	msgTypeCatalog        msgType = "CATALOG"
	msgTypeSpec           msgType = "SPEC"
)

type StreamStatusType string

const (
	StreamStatusStarted    StreamStatusType = "STARTED"
	StreamStatusComplete   StreamStatusType = "COMPLETE"
	StreamStatusIncomplete StreamStatusType = "INCOMPLETE"
)

type streamDescriptor struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type streamStatus struct {
	StreamDescriptor streamDescriptor `json:"stream_descriptor"`
	Status           StreamStatusType `json:"status"`
}

type errorTrace struct {
	StreamDescriptor streamDescriptor `json:"stream_descriptor"`
	Message          string           `json:"message"`
	InternalMessage  string           `json:"internal_message,omitempty"`
	StackTrace       string           `json:"stack_trace,omitempty"`
	FailureType      string           `json:"failure_type,omitempty"`
}

type traceMessage struct {
	Type         string        `json:"type"`
	StreamStatus *streamStatus `json:"stream_status,omitempty"`
	Error        *errorTrace   `json:"error,omitempty"`
}

var errInvalidTypePayload = errors.New("message type and payload are invalid")

type message struct {
	Type                    msgType `json:"type"`
	*record                 `json:"record,omitempty"`
	*state                  `json:"state,omitempty"`
	*logMessage             `json:"log,omitempty"`
	*traceMessage           `json:"trace,omitempty"`
	*ConnectorSpecification `json:"spec,omitempty"`
	*connectionStatus       `json:"connectionStatus,omitempty"`
	*Catalog                `json:"catalog,omitempty"`
}

// message MarshalJSON is a custom marshaller which validates the messageType with the sub-struct
func (m *message) MarshalJSON() ([]byte, error) {
	switch m.Type {
	case msgTypeRecord:
		if m.record == nil ||
			m.state != nil ||
			m.logMessage != nil ||
			m.connectionStatus != nil ||
			m.Catalog != nil {
			return nil, errInvalidTypePayload
		}
	case msgTypeState:
		if m.state == nil ||
			m.record != nil ||
			m.logMessage != nil ||
			m.connectionStatus != nil ||
			m.Catalog != nil {
			return nil, errInvalidTypePayload
		}
	case msgTypeLog:
		if m.logMessage == nil ||
			m.record != nil ||
			m.state != nil ||
			m.connectionStatus != nil ||
			m.Catalog != nil {
			return nil, errInvalidTypePayload
		}
	}

	type m2 message
	return json.Marshal(m2(*m))
}

// write emits data outbound from your src/destination to airbyte workers
func write(w io.Writer, m *message) error {
	return json.NewEncoder(w).Encode(m)
}

// record defines a record as per airbyte - a "data point"
type record struct {
	EmittedAt int64       `json:"emitted_at"`
	Namespace string      `json:"namespace"`
	Data      interface{} `json:"data"`
	Stream    string      `json:"stream"`
}

// state is used to store data between syncs - useful for incremental syncs and state storage
type state struct {
	Data interface{} `json:"data"`
}

// LogLevel defines the log levels that can be emitted with airbyte logs
type LogLevel string

const (
	LogLevelFatal LogLevel = "FATAL"
	LogLevelError LogLevel = "ERROR"
	LogLevelWarn  LogLevel = "WARN"
	LogLevelInfo  LogLevel = "INFO"
	LogLevelDebug LogLevel = "DEBUG"
	LogLevelTrace LogLevel = "TRACE"
)

type logMessage struct {
	Level   LogLevel `json:"level"`
	Message string   `json:"message"`
}

type checkStatus string

const (
	checkStatusSuccess checkStatus = "SUCCEEDED"
	checkStatusFailed  checkStatus = "FAILED"
)

type connectionStatus struct {
	Status checkStatus `json:"status"`
}

// Catalog defines the complete available schema you can sync with a source
// This should not be mistaken with ConfiguredCatalog which is the "selected" schema you want to sync
type Catalog struct {
	Streams []Stream `json:"streams"`
}

// Stream defines a single "schema" you'd like to sync - think of this as a table, collection, topic, etc. In airbyte terminology these are "streams"
type Stream struct {
	Name                    string     `json:"name"`
	JSONSchema              Properties `json:"json_schema"`
	SupportedSyncModes      []SyncMode `json:"supported_sync_modes,omitempty"`
	SourceDefinedCursor     bool       `json:"source_defined_cursor,omitempty"`
	DefaultCursorField      []string   `json:"default_cursor_field,omitempty"`
	SourceDefinedPrimaryKey [][]string `json:"source_defined_primary_key,omitempty"`
	Namespace               string     `json:"namespace"`
	// TableNameTemplate, when set, is the preferred default destination table
	// name for this stream. Useful when the stream Name contains characters
	// (e.g. "/") that don't translate cleanly to a table name.
	TableNameTemplate string `json:"table_name_template,omitempty"`
}

// ConfiguredCatalog is the "selected" schema you want to sync
// This should not be mistaken with Catalog which represents the complete available schema to sync
type ConfiguredCatalog struct {
	Streams []ConfiguredStream `json:"streams"`
}

// ConfiguredStream defines a single selected stream to sync
type ConfiguredStream struct {
	Stream              Stream              `json:"stream"`
	SyncMode            SyncMode            `json:"sync_mode"`
	CursorField         []string            `json:"cursor_field"`
	DestinationSyncMode DestinationSyncMode `json:"destination_sync_mode"`
	PrimaryKey          [][]string          `json:"primary_key"`
}

// SyncMode defines the modes that your source is able to sync in
type SyncMode string

const (
	// SyncModeFullRefresh means the data will be wiped and fully synced on each run
	SyncModeFullRefresh SyncMode = "full_refresh"
	// SyncModeIncremental is used for incremental syncs
	SyncModeIncremental SyncMode = "incremental"
)

// DestinationSyncMode represents how the destination should interpret your data
type DestinationSyncMode string

var (
	// DestinationSyncModeAppend is used for the destination to know it needs to append data
	DestinationSyncModeAppend DestinationSyncMode = "append"
	// DestinationSyncModeOverwrite is used to indicate the destination should overwrite data
	DestinationSyncModeOverwrite DestinationSyncMode = "overwrite"
)

// ConnectorSpecification is used to define the connector wide settings. Every connection using your connector will comply to these settings
type ConnectorSpecification struct {
	DocumentationURL              string                  `json:"documentationUrl,omitempty"`
	ChangeLogURL                  string                  `json:"changeLogUrl"`
	SupportsIncremental           bool                    `json:"supportsIncremental"`
	SupportsNormalization         bool                    `json:"supportsNormalization"`
	SupportsDBT                   bool                    `json:"supportsDBT"`
	SupportedDestinationSyncModes []DestinationSyncMode   `json:"supported_destination_sync_modes"`
	ConnectionSpecification       ConnectionSpecification `json:"connectionSpecification"`
}

// https://json-schema.org/learn/getting-started-step-by-step.html

// Properties defines the property map which is used to define any single "field name" along with its specification
type Properties struct {
	Properties map[PropertyName]PropertySpec `json:"properties"`
}

// PropertyName is a alias for a string to make it clear to the user that the "key" in the map is the name of the property
type PropertyName string

// ConnectionSpecification is used to define the settings that are configurable "per" instance of your connector
type ConnectionSpecification struct {
	Title       string `json:"title"`
	Description string `json:"description"`
	Properties
	Type     string         `json:"type"` // should always be "object"
	Required []PropertyName `json:"required"`
}

// PropType defines the property types any field can take. See more here:  https://docs.airbyte.com/understanding-airbyte/supported-data-types
type PropType string

const (
	String  PropType = "string"
	Number  PropType = "number"
	Integer PropType = "integer"
	Object  PropType = "object"
	Array   PropType = "array"
	Null    PropType = "null"
)

// AirbytePropType is used to define airbyte specific property types. See more here: https://docs.airbyte.com/understanding-airbyte/supported-data-types
type AirbytePropType string

const (
	TimestampWithTZ AirbytePropType = "timestamp_with_timezone"
	TimestampWOTZ   AirbytePropType = "timestamp_without_timezone"
	BigInteger      AirbytePropType = "big_integer"
	BigNumber       AirbytePropType = "big_number"
)

// FormatType is used to define data type formats supported by airbyte where needed (usually for strings formatted as dates). See more here: https://docs.airbyte.com/understanding-airbyte/supported-data-types
type FormatType string

const (
	Date     FormatType = "date"
	DateTime FormatType = "datetime"
)

type PropertyType struct {
	Type        PropType        `json:"type,omitempty"`
	AirbyteType AirbytePropType `json:"airbyte_type,omitempty"`
}
type PropertySpec struct {
	Description  string `json:"description"`
	PropertyType `json:",omitempty"`
	Examples     []string                      `json:"examples,omitempty"`
	Items        map[string]interface{}        `json:"items,omitempty"`
	Properties   map[PropertyName]PropertySpec `json:"properties,omitempty"`
	IsSecret     bool                          `json:"airbyte_secret,omitempty"`
}

// LogWriter is exported for documentation purposes - only use this through LogTracker or MessageTracker
// to ensure thread-safe behavior with the writer
type LogWriter func(level LogLevel, s string) error

// StateWriter is exported for documentation purposes - only use this through MessageTracker
type StateWriter func(v interface{}) error

// RecordWriter is exported for documentation purposes - only use this through MessageTracker
type RecordWriter func(v interface{}, streamName string, namespace string) error

// StreamStatusWriter emits a TRACE message with STREAM_STATUS type
type StreamStatusWriter func(streamName string, namespace string, status StreamStatusType) error

// StreamErrorWriter emits a TRACE message with ERROR type scoped to a single
// stream. It lets a source report a per-stream failure and keep going instead
// of aborting the whole sync.
type StreamErrorWriter func(streamName string, namespace string, message string) error

func newLogWriter(w io.Writer) LogWriter {
	return func(lvl LogLevel, s string) error {
		return write(w, &message{
			Type: msgTypeLog,
			logMessage: &logMessage{
				Level:   lvl,
				Message: s,
			},
		})
	}

}
func newStateWriter(w io.Writer) StateWriter {
	return func(s interface{}) error {
		return write(w, &message{
			Type: msgTypeState,
			state: &state{
				Data: s,
			},
		})
	}
}

func newRecordWriter(w io.Writer) RecordWriter {
	return func(s interface{}, stream string, namespace string) error {
		return write(w, &message{
			Type: msgTypeRecord,
			record: &record{
				EmittedAt: time.Now().UnixMilli(),
				Data:      s,
				Namespace: namespace,
				Stream:    stream,
			},
		})
	}
}

func newStreamStatusWriter(w io.Writer) StreamStatusWriter {
	return func(streamName string, namespace string, status StreamStatusType) error {
		return write(w, &message{
			Type: msgTypeTrace,
			traceMessage: &traceMessage{
				Type: "STREAM_STATUS",
				StreamStatus: &streamStatus{
					StreamDescriptor: streamDescriptor{
						Name:      streamName,
						Namespace: namespace,
					},
					Status: status,
				},
			},
		})
	}
}

func newStreamErrorWriter(w io.Writer) StreamErrorWriter {
	return func(streamName string, namespace string, msg string) error {
		return write(w, &message{
			Type: msgTypeTrace,
			traceMessage: &traceMessage{
				Type: "ERROR",
				Error: &errorTrace{
					StreamDescriptor: streamDescriptor{
						Name:      streamName,
						Namespace: namespace,
					},
					Message: msg,
				},
			},
		})
	}
}
