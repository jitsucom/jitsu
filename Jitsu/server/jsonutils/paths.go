package jsonutils

//JSONPaths supports several JSON paths
// Map:
// 	  "key1/key2/key3" -> JSONPath: [key1, key2, key3]
// 	  "key4/key5/key6" -> JSONPath: [key4, key5, key6]
// 	  "key7/key8/key9" -> JSONPath: [key7, key8, key9]
type JSONPaths struct {
	paths map[string]JSONPath
}

// NewJSONPaths parses configuration settings
// and returns map of parsed recognition nodes
func NewJSONPaths(pathes []string) *JSONPaths {
	container := make(map[string]JSONPath)

	for _, path := range pathes {
		container[path] = NewJSONPath(path)
	}

	return &JSONPaths{
		paths: container,
	}
}

//String returns string representation of JSONPaths
func (jpa *JSONPaths) String() string {
	result := ""

	for key := range jpa.paths {
		if result != "" {
			result += ", "
		}
		result += key
	}

	return "[" + result + "]"
}

// Get returns values from event according to configuration settings
// Map:
// 	  "key1/key2/key3" -> value1
// 	  "key4/key5/key6" -> value2
// 	  "key7/key8/key9" -> value3
func (jpa *JSONPaths) Get(event map[string]interface{}) (map[string]interface{}, bool) {
	result := false
	values := make(map[string]interface{})

	for key, path := range jpa.paths {
		value, answer := path.Get(event)
		values[key] = value
		result = result || answer
	}

	return values, result
}

// Set puts all non nil values into event according to inner JSON paths settings
func (jpa *JSONPaths) Set(event map[string]interface{}, values map[string]interface{}) error {
	for key, path := range jpa.paths {
		value := values[key]
		if value != nil {
			err := path.Set(event, value)
			if err != nil {
				return err
			}
		}
	}

	return nil
}
