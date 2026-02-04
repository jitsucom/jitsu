package sql

import (
	"fmt"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

var (
	ColumnTypesOption = bulker.ImplementationOption[types.SQLTypes]{
		Key:          "columnTypes",
		DefaultValue: nil,
		AdvancedParseFunc: func(o *bulker.ImplementationOption[types.SQLTypes], serializedValue any) (bulker.StreamOption, error) {
			switch v := serializedValue.(type) {
			case map[string]any:
				sqlTypes := types.SQLTypes{}
				for key, value := range v {
					switch t := value.(type) {
					case string:
						sqlTypes.With(key, t)
					case []string:
						if len(t) == 1 {
							sqlTypes.With(key, t[0])
						} else if len(t) == 2 {
							sqlTypes.WithDDL(key, t[0], t[1])
						} else {
							return nil, fmt.Errorf("failed to parse 'columnTypes' option: %v incorrect number of elements. expected 1 or 2", v)
						}
					}
				}
				return withColumnTypes(o, sqlTypes), nil
			default:
				return nil, fmt.Errorf("failed to parse 'columnTypes' option: %v incorrect type: %T expected map[string]any", v, v)
			}
		},
	}

	DeduplicateWindow = bulker.ImplementationOption[int]{
		Key:          "deduplicateWindow",
		DefaultValue: 365,
		ParseFunc:    utils.ParseInt,
	}

	OmitNilsOption = bulker.ImplementationOption[bool]{
		Key:          "omitNils",
		DefaultValue: true,
		ParseFunc:    utils.ParseBool,
	}

	SchemaFreezeOption = bulker.ImplementationOption[bool]{
		Key:          "schemaFreeze",
		DefaultValue: false,
		ParseFunc:    utils.ParseBool,
	}

	MaxColumnsCount = bulker.ImplementationOption[int]{
		Key:          "maxColumnsCount",
		DefaultValue: 5000,
		ParseFunc:    utils.ParseInt,
	}

	DisableTemporaryTables = bulker.ImplementationOption[bool]{
		Key:          "disableTemporaryTables",
		DefaultValue: false,
		ParseFunc:    utils.ParseBool,
	}

	localBatchFileOption = bulker.ImplementationOption[string]{Key: "BULKER_OPTION_LOCAL_BATCH_FILE"}

	s3BatchFileOption = bulker.ImplementationOption[*S3OptionConfig]{Key: "BULKER_OPTION_S3_BATCH_FILE"}
)

func init() {
	bulker.RegisterOption(&DeduplicateWindow)
	bulker.RegisterOption(&ColumnTypesOption)
	bulker.RegisterOption(&OmitNilsOption)
	bulker.RegisterOption(&SchemaFreezeOption)
	bulker.RegisterOption(&MaxColumnsCount)
	bulker.RegisterOption(&DisableTemporaryTables)
}

type S3OptionConfig struct {
	AuthenticationMethod string `mapstructure:"authenticationMethod,omitempty" json:"authenticationMethod,omitempty" yaml:"authenticationMethod,omitempty"`
	AccessKeyID          string `mapstructure:"accessKeyId,omitempty" json:"accessKeyId,omitempty" yaml:"accessKeyId,omitempty"`
	SecretAccessKey      string `mapstructure:"secretAccessKey,omitempty" json:"secretAccessKey,omitempty" yaml:"secretAccessKey,omitempty"`
	RoleARN              string `mapstructure:"roleARN,omitempty" json:"roleARN,omitempty" yaml:"roleARN,omitempty"`
	ExternalID           string `mapstructure:"externalID,omitempty" json:"externalID,omitempty" yaml:"externalID,omitempty"`
	Bucket               string `mapstructure:"bucket,omitempty" json:"bucket,omitempty" yaml:"bucket,omitempty"`
	Region               string `mapstructure:"region,omitempty" json:"region,omitempty" yaml:"region,omitempty"`
	Folder               string `mapstructure:"folder,omitempty" json:"folder,omitempty" yaml:"folder,omitempty"`
	UsePresignedURL      bool   `mapstructure:"usePresignedURL,omitempty" json:"usePresignedURL,omitempty" yaml:"usePresignedURL,omitempty"`
}

func WithOmitNils() bulker.StreamOption {
	return bulker.WithOption(&OmitNilsOption, true)
}

func WithoutOmitNils() bulker.StreamOption {
	return bulker.WithOption(&OmitNilsOption, false)
}

func WithSchemaFreeze() bulker.StreamOption {
	return bulker.WithOption(&SchemaFreezeOption, true)
}

func WithMaxColumnsCount(maxColumnsCount int) bulker.StreamOption {
	return bulker.WithOption(&MaxColumnsCount, maxColumnsCount)
}

func WithDeduplicateWindow(deduplicateWindow int) bulker.StreamOption {
	return bulker.WithOption(&DeduplicateWindow, deduplicateWindow)
}

func withColumnTypes(o *bulker.ImplementationOption[types.SQLTypes], fields types.SQLTypes) bulker.StreamOption {
	return func(options *bulker.StreamOptions) {
		sqlTypes := o.Get(options)
		if len(sqlTypes) == 0 {
			o.Set(options, fields)
		} else {
			utils.MapPutAll(sqlTypes, fields)
		}
	}
}

// WithColumnTypes provides overrides for column types of current BulkerStream object fields
func WithColumnTypes(fields types.SQLTypes) bulker.StreamOption {
	return withColumnTypes(&ColumnTypesOption, fields)
}

// WithColumnType provides overrides for column type of single column for current BulkerStream object fields
func WithColumnType(columnName, sqlType string) bulker.StreamOption {
	return withColumnTypes(&ColumnTypesOption, types.SQLTypes{}.With(columnName, sqlType))
}

// WithColumnTypeDDL provides overrides for column type and DDL type of single column for current BulkerStream object fields
func WithColumnTypeDDL(columnName, sqlType, ddlType string) bulker.StreamOption {
	return withColumnTypes(&ColumnTypesOption, types.SQLTypes{}.WithDDL(columnName, sqlType, ddlType))
}

// WithLocalBatchFile setting for all modes except bulker.Stream
// Not every database solution supports this option
// fileName - name of tmp file that will be used to collection event batches before sending them to destination
func withLocalBatchFile(fileName string) bulker.StreamOption {
	return bulker.WithOption(&localBatchFileOption, fileName)
}

func withS3BatchFile(s3OptionConfig *S3OptionConfig) bulker.StreamOption {
	return bulker.WithOption(&s3BatchFileOption, s3OptionConfig)
}

func WithDisableTemporaryTables() bulker.StreamOption {
	return bulker.WithOption(&DisableTemporaryTables, true)
}
