package schema

import "fmt"

type FieldMappingType string

const (
	Default FieldMappingType = ""
	Strict  FieldMappingType = "strict"

	//action
	MOVE     = "move"
	REMOVE   = "remove"
	CAST     = "cast"
	CONSTANT = "constant"
)

func (f FieldMappingType) String() string {
	if f == Strict {
		return "Strict"
	} else {
		return "Default"
	}
}

type Mapping struct {
	KeepUnmapped *bool          `mapstructure:"keep_unmapped" json:"keep_unmapped,omitempty" yaml:"keep_unmapped,omitempty"`
	Fields       []MappingField `mapstructure:"fields" json:"fields,omitempty" yaml:"fields,omitempty"`
}

type MappingField struct {
	Src    string      `mapstructure:"src" json:"src,omitempty" yaml:"src,omitempty"`
	Dst    string      `mapstructure:"dst" json:"dst,omitempty" yaml:"dst,omitempty"`
	Action string      `mapstructure:"action" json:"action,omitempty" yaml:"action,omitempty"`
	Type   string      `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Value  interface{} `mapstructure:"value" json:"value,omitempty" yaml:"value,omitempty"`
}

func (mf *MappingField) Validate() error {
	if mf.Action != MOVE && mf.Action != REMOVE && mf.Action != CAST && mf.Action != CONSTANT {
		return fmt.Errorf("Unknown mapping action: %s. Available actions: [%s, %s, %s, %s]", mf.Action, MOVE, REMOVE, CAST, CONSTANT)
	}

	//src required only if not CONSTANT
	if mf.Src == "" && mf.Action != CONSTANT {
		return fmt.Errorf("src is required field in mappings with action: [%s, %s, %s]", MOVE, REMOVE, CAST)
	}

	//type required only if CAST
	if mf.Type == "" && mf.Action == CAST {
		return fmt.Errorf("type is required field in mappings with action: [%s]", CAST)
	}

	//dst required only if not REMOVE and not CAST
	if mf.Dst == "" && mf.Action != REMOVE && mf.Action != CAST {
		return fmt.Errorf("dst is required field")
	}

	return nil
}

// /src/ --move--> /dst
// /src/ --move--> (Lowcardinality(String)) /dst
// /src/ --remove-->
// /src/ --cast--> (Lowcardinality(String)) /dst
// value --constant--> (Lowcardinality(String)) /dst
func (mf *MappingField) String() string {
	typeCast := ""
	if mf.Type != "" {
		typeCast = "(" + mf.Type + ")"
	}
	src := mf.Src
	if mf.Action == CONSTANT {
		src = fmt.Sprintf("%v", mf.Value)
	}
	return fmt.Sprintf("%s --[%s]--> %s %s", src, mf.Action, typeCast, mf.Dst)
}
