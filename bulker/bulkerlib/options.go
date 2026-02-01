package bulkerlib

import (
	"fmt"
	"strings"

	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	types2 "github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type StreamOption func(*StreamOptions)

var optionsRegistry = make(map[string]ParseableOption)

// Not used by bulker. Just added here to be treated as known options and don't print errors
var ignoredOptions = []string{"functions", "streams", "dataLayout", "events", "debugTill", "hosts", "schedule", "timezone", "storageKey", "tableNamePrefix", "multithreading", "threadsCount", "keepOriginalNames", "addMeta", "disabled", "functionsClasses"}

var (
	BatchSizeOption = ImplementationOption[int]{
		Key:          "batchSize",
		DefaultValue: 0,
		ParseFunc:    utils.ParseInt,
	}

	BatchSizeBytesOption = ImplementationOption[int]{
		Key:          "batchSizeBytes",
		DefaultValue: 0,
		ParseFunc:    utils.ParseInt,
	}

	TemporaryBatchSizeOption = ImplementationOption[int]{
		Key:          "temporaryBatchSize",
		DefaultValue: 0,
		ParseFunc:    utils.ParseInt,
	}

	// BatchFrequencyOption frequency of running batches in minutes
	BatchFrequencyOption = ImplementationOption[float64]{
		Key:          "frequency",
		DefaultValue: 0,
		ParseFunc:    utils.ParseFloat,
	}

	RetryBatchSizeOption = ImplementationOption[int]{
		Key:          "retryBatchSize",
		DefaultValue: 0,
		ParseFunc:    utils.ParseInt,
	}
	// RetryFrequencyOption frequency of running retry consumer in minutes
	RetryFrequencyOption = ImplementationOption[float64]{
		Key:          "retryFrequency",
		DefaultValue: 0,
		ParseFunc:    utils.ParseFloat,
	}

	ModeOption = ImplementationOption[BulkMode]{Key: "mode", ParseFunc: func(serialized any) (BulkMode, error) {
		switch v := serialized.(type) {
		case string:
			if v == "stream" {
				return Stream, nil
			} else if v == "batch" {
				return Batch, nil
			} else {
				return Unknown, fmt.Errorf("unknown mode: %s", v)
			}
		default:
			return Unknown, fmt.Errorf("invalid value type of mode option: %T", v)
		}
	},
	}

	PrimaryKeyOption = ImplementationOption[types2.OrderedSet[string]]{
		Key:          "primaryKey",
		DefaultValue: types2.OrderedSet[string]{},
		AdvancedParseFunc: func(o *ImplementationOption[types2.OrderedSet[string]], serializedValue any) (StreamOption, error) {
			switch v := serializedValue.(type) {
			case []string:
				return withPrimaryKey(o, v...), nil
			case string:
				if v == "" {
					return func(options *StreamOptions) {}, nil
				}
				keys := utils.ArrayMap(strings.Split(v, ","), strings.TrimSpace)
				return withPrimaryKey(o, keys...), nil
			default:
				return nil, fmt.Errorf("failed to parse 'primaryKey' option: %v incorrect type: %T expected string or []string", v, v)
			}
		},
	}

	DeduplicateOption = ImplementationOption[bool]{
		Key:          "deduplicate",
		DefaultValue: false,
		ParseFunc:    utils.ParseBool,
	}

	PartitionIdOption = ImplementationOption[string]{
		Key:       "partitionId",
		ParseFunc: utils.ParseString,
	}

	NamespaceOption = ImplementationOption[string]{
		Key:       "namespace",
		ParseFunc: utils.ParseString,
	}

	// TimestampOption - field name that contains timestamp. For creating sorting indexes or partitions by that field in destination tables
	TimestampOption = ImplementationOption[string]{
		Key:       "timestampColumn",
		ParseFunc: utils.ParseString,
	}

	// ToSameCaseOption - when true all fields and tables name will be converted to the same case (lowercase for most db, uppercase for snowflake)
	ToSameCaseOption = ImplementationOption[bool]{
		Key:          "toSameCase",
		DefaultValue: false,
		ParseFunc:    utils.ParseBool,
	}

	// SpreadTablesSchedule - when true cron tasks for processing different tables batches will be spread in time to avoid spikes
	SpreadTablesSchedule = ImplementationOption[bool]{
		Key:          "spreadTablesSchedule",
		DefaultValue: false,
		ParseFunc:    utils.ParseBool,
	}

	// DiscriminatorFieldOption - array represents path to the object property. when deduplicate is true, and multiple rows has the same primary key, row with the highest value of this field will be selected
	DiscriminatorFieldOption = ImplementationOption[[]string]{
		Key:          "discriminatorField",
		DefaultValue: nil,
		ParseFunc: func(serializedValue any) ([]string, error) {
			switch v := serializedValue.(type) {
			case []string:
				return v, nil
			case string:
				if v == "" {
					return nil, nil
				}
				keys := utils.ArrayMap(strings.Split(v, ","), strings.TrimSpace)
				return keys, nil
			default:
				return nil, fmt.Errorf("failed to parse 'discriminatorField' option: %v incorrect type: %T expected string or []string", v, v)
			}
		},
	}

	SchemaOption = ImplementationOption[types.Schema]{
		Key: "schema",
		ParseFunc: func(serialized any) (types.Schema, error) {
			switch v := serialized.(type) {
			case types.Schema:
				return v, nil
			case string:
				schema := types.Schema{}
				err := jsoniter.Unmarshal([]byte(v), &schema)
				if err != nil {
					return types.Schema{}, fmt.Errorf("failed to parse schema: %v", err)
				}
				return schema, nil
			default:
				return types.Schema{}, fmt.Errorf("invalid value type of schema option: %T", v)
			}
		},
	}

	FunctionsEnvOption = ImplementationOption[map[string]any]{Key: "functionsEnv", ParseFunc: func(serialized any) (map[string]any, error) {
		switch v := serialized.(type) {
		case map[string]any:
			return v, nil
		case string:
			var env map[string]any
			err := jsoniter.Unmarshal([]byte(v), &env)
			if err != nil {
				return nil, fmt.Errorf("failed to parse functionsEnv: %v", err)
			}
			return env, nil
		default:
			return nil, fmt.Errorf("invalid value type of functionsEnv option: %T", v)
		}
	}}
)

func init() {
	RegisterOption(&ModeOption)
	RegisterOption(&BatchSizeOption)
	RegisterOption(&BatchSizeBytesOption)
	RegisterOption(&TemporaryBatchSizeOption)
	RegisterOption(&BatchFrequencyOption)
	RegisterOption(&RetryFrequencyOption)
	RegisterOption(&RetryBatchSizeOption)
	RegisterOption(&PrimaryKeyOption)
	RegisterOption(&DeduplicateOption)
	RegisterOption(&PartitionIdOption)
	RegisterOption(&TimestampOption)
	RegisterOption(&SchemaOption)
	RegisterOption(&NamespaceOption)
	RegisterOption(&ToSameCaseOption)
	RegisterOption(&FunctionsEnvOption)
	RegisterOption(&SpreadTablesSchedule)
	RegisterOption(&DiscriminatorFieldOption)

	dummyParse := func(_ any) (any, error) { return nil, nil }
	for _, ignoredOption := range ignoredOptions {
		RegisterOption(&ImplementationOption[any]{Key: ignoredOption, ParseFunc: dummyParse})
	}

}

func RegisterOption[V any](option *ImplementationOption[V]) {
	optionsRegistry[option.Key] = option
}

func ParseOption(name string, serialized any) (StreamOption, error) {
	option, ok := optionsRegistry[name]
	if !ok {
		return nil, fmt.Errorf("unknown option %s", name)
	}
	return option.Parse(serialized)

}

type StreamOptions struct {
	// Implementation options - map by option key. Values are parsed and validated
	// Don't access this map directly, use 'Get' method of specific option instance. E.g. `PartitionIdOption.Get(&so)`
	valuesMap map[string]any
	// options slice. To pass to CreateStream method
	Options []StreamOption
}

func (so *StreamOptions) Add(option StreamOption) {
	option(so)
	so.Options = append(so.Options, option)
}

type ParseableOption interface {
	Parse(serialized any) (StreamOption, error)
}

type ImplementationOption[V any] struct {
	Key               string
	DefaultValue      V
	ParseFunc         func(serialized any) (V, error)
	AdvancedParseFunc func(*ImplementationOption[V], any) (StreamOption, error)
}

func (io *ImplementationOption[V]) Parse(serializedValue any) (StreamOption, error) {
	if io.ParseFunc != nil {
		val, err := io.ParseFunc(serializedValue)
		if err != nil {
			return nil, fmt.Errorf("failed to parse '%s' option: %v", io.Key, err)
		}
		return func(options *StreamOptions) {
			io.Set(options, val)
		}, nil
	} else {
		return io.AdvancedParseFunc(io, serializedValue)
	}
}

func (io *ImplementationOption[V]) Get(so *StreamOptions) V {
	opt, ok := so.valuesMap[io.Key].(V)
	if ok {
		return opt
	}
	return io.DefaultValue
}

func (io *ImplementationOption[V]) Set(so *StreamOptions, value V) {
	if so.valuesMap == nil {
		so.valuesMap = map[string]any{io.Key: value}
	} else {
		so.valuesMap[io.Key] = value
	}
}

func WithOption[T any](o *ImplementationOption[T], value T) StreamOption {
	return func(options *StreamOptions) {
		o.Set(options, value)
	}
}

func withPrimaryKey(o *ImplementationOption[types2.OrderedSet[string]], pkFields ...string) StreamOption {
	return func(options *StreamOptions) {
		set := o.Get(options)
		if set.Empty() {
			o.Set(options, types2.NewOrderedSet(pkFields...))
		} else {
			set.PutAll(pkFields)
		}
	}
}

func WithPrimaryKey(pkFields ...string) StreamOption {
	return withPrimaryKey(&PrimaryKeyOption, pkFields...)
}

// WithDeduplicate - when true merge rows on primary keys collision.
func WithDeduplicate() StreamOption {
	return WithOption(&DeduplicateOption, true)
}

// WithPartition settings for bulker.ReplacePartition mode only
// partitionId - value of `__partition_id`  for current BulkerStream e.g. id of current partition
// TODO: For bigquery require string in special format
func WithPartition(partitionId string) StreamOption {
	return WithOption(&PartitionIdOption, partitionId)
}

func WithTimestamp(timestampField string) StreamOption {
	return WithOption(&TimestampOption, timestampField)
}

func WithDiscriminatorField(discriminatorField []string) StreamOption {
	return WithOption(&DiscriminatorFieldOption, discriminatorField)
}

func WithSchema(schema types.Schema) StreamOption {
	return WithOption(&SchemaOption, schema)
}

func WithNamespace(namespace string) StreamOption {
	return WithOption(&NamespaceOption, namespace)
}

func WithToSameCase() StreamOption {
	return WithOption(&ToSameCaseOption, true)
}

func WithTemporaryBatchSize(temporaryBatchSize int) StreamOption {
	return WithOption(&TemporaryBatchSizeOption, temporaryBatchSize)
}

func WithBatchSizeBytes(batchSizeBytes int) StreamOption {
	return WithOption(&BatchSizeBytesOption, batchSizeBytes)
}
