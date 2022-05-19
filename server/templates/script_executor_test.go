package templates_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/stretchr/testify/assert"
)

type (
	anySlice = []interface{}
	anyMap   = map[string]interface{}
)

func TestLoadSourcePlugins(t *testing.T) {
	logging.LogLevel = logging.INFO

	factory, err := node.NewFactory(1, 1000)
	if !assert.NoError(t, err) {
		t.FailNow()
	}

	defer factory.Close()

	templates.SetScriptFactory(factory)

	plugins := []string{
		"jitsu-airtable-source",
		"jitsu-amplitude-source",
		"jitsu-facebook-marketing-source",
		"jitsu-firebase-source",
		"jitsu-google-ads-source",
		"jitsu-google-analytics-source",
		"jitsu-google-play-source",
		"jitsu-redis-source",
	}

	for _, plugin := range plugins {
		executor, err := templates.NewSourceExecutor(&templates.SourcePlugin{
			Package: plugin,
			ID:      "test-source",
			Type:    "test-type",
		})

		if !assert.NoErrorf(t, err, "load plugin %s", plugin) {
			continue
		}

		assert.NotEqualf(t, 0, len(executor.Spec()), "plugin %s spec is empty", plugin)

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
