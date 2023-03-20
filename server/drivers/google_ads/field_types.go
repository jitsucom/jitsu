package google_ads

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/httputils"
	"io"
	"net/http"
	"strings"
)

// Use ExampleLoadFieldTypes to refresh fields.csv with actual types from Google Ads API
//
//go:embed fields.csv
var fieldsCsv string
var fieldTypes = make(map[string]string)

type gadsFieldDetails struct {
	DataType string `json:"data_type"`
}
type gadsField struct {
	FieldDetails gadsFieldDetails `json:"field_details"`
}
type gadsSchema struct {
	Fields map[string]gadsField `json:"fields"`
}

func init() {
	for _, str := range strings.Split(fieldsCsv, "\n") {
		split := strings.Split(str, ",")
		fieldTypes[split[0]] = split[1]
	}
}

func LoadFieldTypes() error {
	httpClient := &http.Client{}
	parseResponse := func(status int, body io.Reader, header http.Header) (interface{}, error) {
		jsonDecoder := json.NewDecoder(body)
		var bodyObject = gadsSchema{}
		if err := jsonDecoder.Decode(&bodyObject); err != nil {
			return nil, fmt.Errorf("failed to unmarshal response: %s", err)
		}
		return &bodyObject, nil
	}
	totalRes := map[string]gadsField{}
	for rep := range availableReports {
		req := httputils.Request{URL: "https://gaql-query-builder.uc.r.appspot.com/schemas/v13/" + rep + ".json", Method: http.MethodGet,
			ParseReader: parseResponse}

		obj, err := req.Do(httpClient)
		if err != nil {
			return err
		}
		for k, v := range obj.(*gadsSchema).Fields {
			old, ok := totalRes[k]
			if ok && old.FieldDetails.DataType != v.FieldDetails.DataType {
				fmt.Printf("Type mismatch for %s: %s vs %s\n", k, old.FieldDetails.DataType, v.FieldDetails.DataType)
			}
			totalRes[k] = v
		}
	}
	fmt.Printf("Loaded %d field types:\n", len(totalRes))
	for k, v := range totalRes {
		fmt.Printf("%s,%s\n", k, v.FieldDetails.DataType)
	}

	return nil
}
