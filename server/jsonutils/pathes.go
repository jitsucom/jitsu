package jsonutils

// It is a map of configuration settings
// Map:
// 	  "key1/key2/key3" -> JSONPath: [key1, key2, key3]
// 	  "key4/key5/key6" -> JSONPath: [key4, key5, key6]
// 	  "key7/key8/key9" -> JSONPath: [key7, key8, key9]
type JSONPathes struct {
	pathes map[string]*JSONPath
}

// NewJSONPathes parses configuration settings
// and returns map of parsed recognition nodes
func NewJSONPathes(pathes []string) *JSONPathes {
	container := make(map[string]*JSONPath)

	for _, path := range pathes {
		container[path] = NewJSONPath(path)
	}

	return &JSONPathes{
		pathes: container,
	}
}

func (jpa *JSONPathes) String() string {
	result := ""

	for key := range jpa.pathes {
		if result != "" {
			result += ", "
		}
		result += key
	}

	return "[" + result + "]"
}

// Get returns values from event according to configuration settings
func (jpa *JSONPathes) Get(event map[string]interface{}) (map[string]interface{}, bool) {
	result := false
	array := make(map[string]interface{})

	for key, path := range jpa.pathes {
		value, answer := path.Get(event)
		array[key] = value
		result = result || answer
	}

	return array, result
}

// Set puts values into event according to configuration settings
func (jpa *JSONPathes) Set(event map[string]interface{}, values map[string]interface{}) error {
	for key, path := range jpa.pathes {
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
