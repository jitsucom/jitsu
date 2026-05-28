package main

import (
	"fmt"

	"github.com/jitsucom/bulker/bulkerlib/types"
	types2 "github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

const (
	LogType              = "LOG"
	ConnectionStatusType = "CONNECTION_STATUS"
	StateType            = "STATE"
	RecordType           = "RECORD"
	TraceType            = "TRACE"
	DebugType            = "DEBUG"
	CatalogType          = "CATALOG"
	ControlType          = "CONTROL"
	SpecType             = "SPEC"
)

// Row is a dto for airbyte output row representation
type Row struct {
	Type             string                          `json:"type"`
	Log              *LogRow                         `json:"log,omitempty"`
	ConnectionStatus *StatusRow                      `json:"connectionStatus,omitempty"`
	State            *StateRow                       `json:"state,omitempty"`
	Record           *RecordRow                      `json:"record,omitempty"`
	Trace            *TraceRow                       `json:"trace,omitempty"`
	Catalog          *types2.OrderedMap[string, any] `json:"catalog,omitempty"`
	Spec             *types2.OrderedMap[string, any] `json:"spec,omitempty"`
	// From DEBUG type
	Message string `json:"message,omitempty"`
	Data    any    `json:"data,omitempty"`
}

// LogRow is a dto for airbyte logs serialization
type LogRow struct {
	Level      string `json:"level,omitempty"`
	Message    string `json:"message,omitempty"`
	StackTrace string `json:"stack_trace,omitempty"`
}

type StreamDescriptor struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
}

type StreamStatus struct {
	StreamDescriptor StreamDescriptor     `json:"stream_descriptor"`
	Status           string               `json:"status"`
	Reasons          []StreamStatusReason `json:"reasons,omitempty"`
}

type StreamStatusReason struct {
	Type        string                        `json:"type"`
	RateLimited StreamStatusRateLimitedReason `json:"rate_limited,omitempty"`
}

type StreamStatusRateLimitedReason struct {
	QuotaReset int64 `json:"quota_reset"`
}

// TraceRow is a dto for airbyte trace serialization
type TraceRow struct {
	Type         string               `json:"type"`
	StreamStatus StreamStatus         `json:"stream_status,omitempty"`
	Error        ErrorTraceMessage    `json:"error,omitempty"`
	Estimate     EstimateTraceMessage `json:"estimate,omitempty"`
}

type ErrorTraceMessage struct {
	StreamDescriptor StreamDescriptor `json:"stream_descriptor"`
	Message          string           `json:"message"`
	InternalMessage  string           `json:"internal_message"`
	StackTrace       string           `json:"stack_trace"`
	FailureType      string           `json:"failure_type"`
}

type EstimateTraceMessage struct {
	Name         string `json:"name"`
	Namespace    string `json:"namespace"`
	Type         string `json:"type"`
	RowEstimate  int    `json:"row_estimate"`
	ByteEstimate int    `json:"byte_estimate"`
}

// StatusRow is a dto for airbyte result status serialization
type StatusRow struct {
	Status  string `json:"status,omitempty"`
	Message string `json:"message,omitempty"`
}

type StreamState struct {
	StreamDescriptor StreamDescriptor `json:"stream_descriptor"`
	StreamState      map[string]any   `json:"stream_state,omitempty"`
}

type GlobalState struct {
	SharedState  map[string]any `json:"shared_state,omitempty"`
	StreamStates []StreamState  `json:"stream_states,omitempty"`
}

// StateRow is a dto for airbyte state serialization
type StateRow struct {
	Type        string                          `json:"type,omitempty"`
	StreamState *StreamState                    `json:"stream,omitempty"`
	GlobalState *GlobalState                    `json:"global,omitempty"`
	Data        *types2.OrderedMap[string, any] `json:"data,omitempty"`
}

// RecordRow is a dto for airbyte record serialization
type RecordRow struct {
	Stream    string                          `json:"stream,omitempty"`
	Namespace string                          `json:"namespace,omitempty"`
	Data      *types2.OrderedMap[string, any] `json:"data,omitempty"`
}

type Catalog struct {
	Streams []*Stream `json:"streams,omitempty"`
}

type StreamMeta struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	//CustomNamespace    string           `json:"custom_namespace"`
	TableName string `json:"table_name,omitempty"`
	// TableNameTemplate is the source-provided default table name, used when the
	// user hasn't set an explicit TableName. Useful when Name contains
	// characters (e.g. "/") that aren't valid in a table name.
	TableNameTemplate  string           `json:"table_name_template,omitempty"`
	JSONSchema         StreamJsonSchema `json:"json_schema"`
	PrimaryKeys        [][]string       `json:"source_defined_primary_key"`
	DefaultCursorField []string         `json:"default_cursor_field"`
}

type StreamJsonSchema struct {
	Properties *types2.OrderedMap[string, any] `json:"properties"`
}

func (s *StreamMeta) ToSchema() types.Schema {
	fields := make([]types.SchemaField, 0, s.JSONSchema.Properties.Len())
	for el := s.JSONSchema.Properties.Front(); el != nil; el = el.Next() {
		fields = append(fields, types.SchemaField{
			Name: el.Key,
			Type: StreamSchemaPropertyToDataType(el.Value.(*types2.OrderedMap[string, any])),
		})
	}
	return types.Schema{
		Name:   s.Name,
		Fields: fields,
	}
}

type StreamSchemaProperty struct {
	Type        any    `json:"type"`
	Format      string `json:"format"`
	AirbyteType string `json:"airbyte_type"`
	OneOf       []any  `json:"oneOf"`
}

func StreamSchemaPropertyToDataType(ssp *types2.OrderedMap[string, any]) types.DataType {
	if len(ssp.GetS("oneOf")) > 0 {
		return types.STRING
	}
	var tp string
	switch v := ssp.GetN("type").(type) {
	case string:
		tp = v
	case []string:
		a := utils.ArrayExcluding(v, "null")
		if len(a) > 0 {
			tp = a[0]
		}
	case []any:
		a := utils.ArrayExcluding(v, "null")
		if len(a) > 0 {
			tp = fmt.Sprint(a[0])
		}
	}
	switch tp {
	case "string":
		f := ssp.GetS("format")
		if f == "date-time" || f == "date" {
			return types.TIMESTAMP
		}
		return types.STRING
	case "boolean":
		return types.BOOL
	case "integer":
		return types.INT64
	case "number":
		if ssp.GetS("airbyte_type") == "integer" {
			return types.INT64
		}
		return types.FLOAT64
	case "array":
		return types.JSON
	case "object":
		return types.JSON
	default:
		return types.STRING
	}
}

func (s *StreamMeta) GetPrimaryKeys() []string {
	if len(s.PrimaryKeys) == 0 {
		return []string{}
	}
	pks := make([]string, 0, len(s.PrimaryKeys))
	for _, pk := range s.PrimaryKeys {
		pks = append(pks, pk...)
	}
	return pks
}

type Stream struct {
	*StreamMeta `json:"stream,omitempty"`
	SyncMode    string   `json:"sync_mode"`
	CursorField []string `json:"cursor_field"`
}
