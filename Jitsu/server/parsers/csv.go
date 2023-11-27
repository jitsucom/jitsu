package parsers

import (
	"encoding/csv"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"strings"
)

//ParseCsv return objects with formatted keys:
//toLower and replaced all spaces with underscore
//cast types
func ParseCsv(r io.Reader, typeConverts map[string]func(interface{}) (interface{}, error)) ([]map[string]interface{}, error) {
	var objects []map[string]interface{}
	csvReader := csv.NewReader(r)

	line, readErr := csvReader.Read()
	if readErr != nil {
		return nil, readErr
	}

	var header []string
	for readErr == nil {
		if len(header) == 0 {
			for _, field := range line {
				header = append(header, strings.ToLower(strings.ReplaceAll(field, " ", "_")))
			}
		} else {
			lineObject := map[string]interface{}{}
			for i, k := range header {
				strValue := line[i]
				convertFunc, ok := typeConverts[k]
				if ok {
					castedValue, err := convertFunc(strValue)
					if err != nil {
						logging.Warnf("Error casting [%s] csv field from string with %v rules: %v", k, typeConverts, err)
						lineObject[k] = strValue
					} else {
						lineObject[k] = castedValue
					}
				} else {
					lineObject[k] = strValue
				}
			}

			objects = append(objects, lineObject)
		}

		line, readErr = csvReader.Read()
		if readErr != nil && readErr != io.EOF {
			return nil, fmt.Errorf("Error reading csv line: %v", readErr)
		}
	}

	return objects, nil
}
