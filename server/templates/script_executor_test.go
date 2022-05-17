package templates_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/stretchr/testify/assert"
)

type (
	anySlice = []interface{}
	anyMap   = map[string]interface{}
)

var sourceLoadTests = []struct {
	name    string
	spec    anyMap
	catalog anySlice
}{
	{
		name: "jitsu-airtable-source",
		spec: anyMap{
			"configurationParameters": anySlice{
				anyMap{
					"displayName":   "API Key",
					"documentation": "Read on how to get API key here: https://support.airtable.com/hc/en-us/articles/219046777-How-do-I-get-my-API-key-",
					"id":            "apiKey",
					"required":      true,
				},
				anyMap{
					"displayName":   "Base Id",
					"documentation": "Read how to get Base ID: https://support.airtable.com/hc/en-us/articles/4405741487383-Understanding-Airtable-IDs",
					"id":            "baseId",
					"required":      true,
				},
			},
			"description": "This source pulls data from Airtable base",
			"displayName": "Airtable Source",
			"id":          "airtable",
		},
		catalog: anySlice{
			anyMap{
				"type":           "table",
				"supportedModes": anySlice{"full_sync"},
				"params": anySlice{
					anyMap{
						"id":            "tableId",
						"displayName":   "Table Id",
						"documentation": "Read how to get table id: https://support.airtable.com/hc/en-us/articles/4405741487383-Understanding-Airtable-IDs",
						"required":      true,
					},
					anyMap{
						"id":            "viewId",
						"displayName":   "View Id",
						"documentation": "Read how to get view id: https://support.airtable.com/hc/en-us/articles/4405741487383-Understanding-Airtable-IDs",
						"required":      false,
					},
					anyMap{
						"id":            "fields",
						"displayName":   "Fields",
						"documentation": "Comma separated list of field names. If empty or undefined - all fields will be downloaded",
						"required":      false,
					},
				},
			},
		},
	},
}

func TestLoadSourcePlugins(t *testing.T) {
	factory, err := node.NewFactory(1, 100)
	if !assert.NoError(t, err) {
		t.FailNow()
	}

	defer factory.Close()

	templates.SetScriptFactory(factory)

	for _, data := range sourceLoadTests {
		executor, err := templates.NewSourceExecutor(&templates.SourcePlugin{
			Package: data.name,
			ID:      "test-source",
			Type:    "test-type",
		})

		if !assert.NoError(t, err, "load plugin %s", data.name) {
			continue
		}

		assert.Equal(t, data.spec, executor.Spec(), "check spec in %s", data.name)

		catalog, err := executor.Catalog()
		if assert.NoError(t, err, "load catalog in %s", data.name) {
			assert.Equal(t, data.catalog, catalog, "check catalog in %s", data.name)
		}

		executor.Close()
	}
}

type testingSourceRecord struct {
	ID   string `json:"__id"`
	Data string `json:"data"`
}

type testingSourceListener struct {
	t       *testing.T
	records []testingSourceRecord
}

func (l *testingSourceListener) Data(data []byte) {
	var record struct {
		Type    string              `json:"type"`
		Message testingSourceRecord `json:"message"`
	}

	if err := json.Unmarshal(data, &record); err != nil {
		l.t.Fatal(err)
	}

	if !assert.Equal(l.t, "record", record.Type) {
		l.t.FailNow()
	}

	l.records = append(l.records, record.Message)
}

func (l *testingSourceListener) Log(level, message string) {

}

func (l *testingSourceListener) Timeout() time.Duration {
	return 0
}

func TestExecuteTestingSource(t *testing.T) {
	factory, err := node.NewFactory(1, 100)
	if !assert.NoError(t, err) {
		t.FailNow()
	}

	defer factory.Close()

	templates.SetScriptFactory(factory)

	plugin := &templates.SourcePlugin{
		Package: "jitsu-testing-source",
		ID:      "test-source",
		Type:    "test-type",
		Config:  anyMap{},
	}

	executor, err := templates.NewSourceExecutor(plugin)

	if !assert.NoError(t, err) {
		t.FailNow()
	}

	defer executor.Close()

	assert.Equal(t, anyMap{
		"configurationParameters": anySlice{
			anyMap{
				"displayName":   "Dummy data",
				"documentation": "Dummy data",
				"id":            "data",
				"required":      true,
			},
		},
		"description": "Source for integration testing",
		"displayName": "Testing Source",
		"id":          "testing-source",
	}, executor.Spec())

	catalog, err := executor.Catalog()
	if assert.NoError(t, err) {
		assert.Equal(t, anySlice{}, catalog)
	}

	// initial config is invalid
	err = executor.Validate()
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "data must not be empty")
	}

	// now let's provide a valid config
	plugin.Config["data"] = "123"
	assert.NoError(t, executor.Validate())

	listener := testingSourceListener{t: t}
	_, err = executor.Stream("testing-stream", nil, nil, &listener)
	if !assert.NoError(t, err) {
		t.FailNow()
	}

	assert.Equal(t, []testingSourceRecord{
		{
			ID:   "1",
			Data: "123",
		},
		{
			ID:   "2",
			Data: "123",
		},
	}, listener.records)
}
