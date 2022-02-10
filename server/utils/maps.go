package utils

func StringMapPutAll(destination map[string]string, source map[string]string) {
	for k, v := range source {
		destination[k] = v
	}
}

func MapPutAll(destination map[string]interface{}, source map[string]interface{}) {
	for k, v := range source {
		destination[k] = v
	}
}
