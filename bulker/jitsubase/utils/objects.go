package utils

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/mitchellh/mapstructure"
	"gopkg.in/yaml.v3"
	"strings"
	"time"
)

// ParseObject parses struct of any type from input object that can be:
//
// map, json string or yaml string,
//
// already struct of provided type or pointer to it
func ParseObject[K any](inputObject any, result *K) error {
	if result == nil {
		return fmt.Errorf("result variable must be an empty struct of desired type, got nil")
	}
	switch cfg := inputObject.(type) {
	case *K:
		*result = *cfg
	case K:
		*result = cfg
	case map[string]any:
		if err := mapstructure.Decode(cfg, result); err != nil {
			return fmt.Errorf("failed to parse map as %T : %s", result, DescribeConfigError(err))
		}
	case []byte:
		if len(cfg) == 0 {
			return fmt.Errorf("failed to parse. input data is empty")
		}
		if cfg[0] == '{' {
			if err := jsoniter.Unmarshal(cfg, result); err != nil {
				return fmt.Errorf("failed to parse json as %T : %s", result, DescribeConfigError(err))
			}
		} else {
			if err := yaml.Unmarshal(cfg, result); err != nil {
				return fmt.Errorf("failed to parse yaml as %T : %s", result, DescribeConfigError(err))
			}
		}
	case string:
		if len(cfg) == 0 {
			return fmt.Errorf("failed to parse. input string is empty")
		}
		if cfg[0] == '{' {
			if err := jsoniter.Unmarshal([]byte(cfg), result); err != nil {
				return fmt.Errorf("failed to parse json as %T : %s", result, DescribeConfigError(err))
			}
		} else {
			if err := yaml.Unmarshal([]byte(cfg), result); err != nil {
				return fmt.Errorf("failed to parse yaml as %T : %s", result, DescribeConfigError(err))
			}
		}
	default:
		return fmt.Errorf("can't parse object from type: %T", cfg)
	}
	return nil
}

func ExtractObject(object any, path ...string) (any, error) {
	mp, ok := object.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("Expected object of type map[string]any got: %T", object)
	}
	last := len(path) == 1
	val, ok := mp[path[0]]
	if !last && (!ok || val == nil) {
		return nil, fmt.Errorf("Failed to reach end of the path. Left path: %s", path)
	}
	if last {
		return val, nil
	}
	return ExtractObject(val, path[1:]...)
}

// Nvl returns first not null object or pointer from varargs
//
// return nil if all passed arguments are nil
func Nvl[T comparable](args ...T) T {
	var empty T
	for _, str := range args {
		if str != empty {
			return str
		}
	}
	return empty
}

// NvlMap returns first not empty map from varargs
//
// return nil if all passed maps are empty
func NvlMap(args ...map[string]any) map[string]any {
	for _, str := range args {
		if len(str) > 0 {
			return str
		}
	}
	return nil
}

func CompareAny(a, b any) int {
	if a == nil {
		if b == nil {
			return 0
		}
		return -1
	} else if b == nil {
		return 1
	} else if a == b {
		return 0
	} else {
		switch va := a.(type) {
		case string:
			vb, ok := b.(string)
			return Ternary(ok, strings.Compare(va, vb), 0)
		case int:
			vb, ok := b.(int)
			return Ternary(ok, va-vb, 0)
		case int64:
			vb, ok := b.(int64)
			return Ternary(ok, int(va-vb), 0)
		case json.Number:
			vb, ok := b.(json.Number)
			if !ok {
				return 0
			}
			fa, _ := va.Float64()
			fb, _ := vb.Float64()
			return Ternary(fa > fb, 1, -1)
		case float64:
			vb, ok := b.(float64)
			if !ok {
				return 0
			}
			return Ternary(va > vb, 1, -1)
		case time.Time:
			vb, ok := b.(time.Time)
			return Ternary(ok, va.Compare(vb), 0)
		default:
			return 0
		}
	}

}
