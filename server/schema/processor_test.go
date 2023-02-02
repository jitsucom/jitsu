package schema

import (
	"io/ioutil"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/spf13/viper"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/useragent"
	"github.com/stretchr/testify/require"
)

func TestProcessFilePayload(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)

	err := appconfig.Init(false, "")
	require.NoError(t, err)

	testTime1, _ := time.Parse(time.RFC3339Nano, "2020-07-02T18:23:59.757719Z")
	testTime2, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:56.291383Z")
	testTime3, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:59.757719Z")
	testTime4, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:58.057807Z")

	tests := []struct {
		name            string
		parseFunc       func([]byte) (map[string]interface{}, error)
		inputFilePath   string
		expected        map[string]*ProcessedFile
		expectedFailed  []events.FailedEvent
		expectedSkipped []events.SkippedEvent
	}{
		{
			"Empty input file",
			parsers.ParseJSON,
			"../test_data/fact_input_empty_1.0.log",
			map[string]*ProcessedFile{},
			[]events.FailedEvent{},
			[]events.SkippedEvent{},
		},
		{
			"Input file with some errors and one skipped line",
			parsers.ParseJSON,
			"../test_data/fact_input_with_error_lines_1.0.log",
			map[string]*ProcessedFile{
				"user_2020_07": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "NY", "_timestamp": testTime1, "event_type": "user", "key1": 120.0, "key3": "privvvv"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_07",
						Fields: Fields{
							"_geo_data_region": NewField(typing.STRING),
							"_timestamp":       NewField(typing.TIMESTAMP),
							"event_type":       NewField(typing.STRING),
							"key1":             NewField(typing.FLOAT64),
							"key3":             NewField(typing.STRING)}},
				},

				"user_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": "k"},
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": 50.0},
					{"_geo_data_zip": int64(10128), "_timestamp": testTime3, "event_type": "user", "key1": "10", "key10": "[1,2,3,4]", "key3": "privvvv"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_08", Fields: Fields{
						"_geo_data_city":    NewField(typing.STRING),
						"_geo_data_country": NewField(typing.STRING),
						"_geo_data_zip":     NewField(typing.INT64),
						"_timestamp":        NewField(typing.TIMESTAMP),
						"event_type":        NewField(typing.STRING),
						"key1":              NewField(typing.STRING),
						"key10":             NewField(typing.STRING),
						"key10_sib1_1": Field{
							dataType:       nil,
							typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.FLOAT64: true},
						},
						"key1_key2": NewField(typing.STRING),
						"key3":      NewField(typing.STRING)}},
				},

				"notification_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_latitude": 40.7809, "_geo_data_longitude": -73.9502, "_timestamp": testTime4, "event_type": "notification", "key1_key2": "123", "key3": "privvvv", "key5": "[1,2,4,5]"},
				},
					BatchHeader: &BatchHeader{TableName: "notification_2020_08", Fields: Fields{
						"_geo_data_latitude":  NewField(typing.FLOAT64),
						"_geo_data_longitude": NewField(typing.FLOAT64),
						"_timestamp":          NewField(typing.TIMESTAMP),
						"event_type":          NewField(typing.STRING),
						"key1_key2":           NewField(typing.STRING),
						"key5":                NewField(typing.STRING),
						"key3":                NewField(typing.STRING)}},
				},

				"null_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "null", "_timestamp": testTime3, "key1": 9999999.0},
				},
					BatchHeader: &BatchHeader{TableName: "null_2020_08", Fields: Fields{
						"_geo_data_region": NewField(typing.STRING),
						"_timestamp":       NewField(typing.TIMESTAMP),
						"key1":             NewField(typing.FLOAT64)}},
				},
			},
			[]events.FailedEvent{{Event: []byte(`{"_geo_data":{},"event_type":"views","key1000":"super value"}`), Error: "error extracting table name: _timestamp field doesn't exist"}},
			[]events.SkippedEvent{{Event: []byte(`{"_geo_data":{"city":"New York","country":"US"},"_timestamp":"2020-08-02T18:23:56.291383Z","event_type":"skipped","eventn_ctx_event_id":"qoow1","key1":{"key2":"splu"},"key10":{"sib1":{"1":"k"}}}`), Error: "Transform or table name filter marked object to be skipped. This object will be skipped."}},
		},
		{
			"Input fallback file",
			events.ParseFallbackJSON,
			"../test_data/fallback_fact_input.log",
			map[string]*ProcessedFile{
				"user_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": "k"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_08", Fields: Fields{
						"_geo_data_city":    NewField(typing.STRING),
						"_geo_data_country": NewField(typing.STRING),
						"_timestamp":        NewField(typing.TIMESTAMP),
						"event_type":        NewField(typing.STRING),
						"key10_sib1_1":      NewField(typing.STRING),
						"key1_key2":         NewField(typing.STRING)}},
				},

				"null_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_latitude": 40.7809, "_geo_data_longitude": -73.9502, "_timestamp": testTime4, "key1_key2": "123", "key3": "privvvv", "key5": "[1,2,4,5]"},
				},
					BatchHeader: &BatchHeader{TableName: "null_2020_08", Fields: Fields{
						"_geo_data_latitude":  NewField(typing.FLOAT64),
						"_geo_data_longitude": NewField(typing.FLOAT64),
						"_timestamp":          NewField(typing.TIMESTAMP),
						"key1_key2":           NewField(typing.STRING),
						"key5":                NewField(typing.STRING),
						"key3":                NewField(typing.STRING)}},
				},
			},
			[]events.FailedEvent{},
			[]events.SkippedEvent{},
		},
	}
	destination := &config.DestinationConfig{Type: "google_analytics", BreakOnError: false,
		DataLayout: &config.DataLayout{Transform: ""}}
	p, err := NewProcessor("test", destination, false, `{{if .event_type}}{{if eq .event_type "skipped"}}{{else}}{{.event_type}}_{{._timestamp.Format "2006_01"}}{{end}}{{else}}{{.event_type}}_{{._timestamp.Format "2006_01"}}{{end}}`, &DummyMapper{}, []enrichment.Rule{}, NewFlattener(), NewTypeResolver(), identifiers.NewUniqueID("/eventn_ctx/event_id"), 0, "new", false)
	require.NoError(t, err)
	err = p.InitJavaScriptTemplates()
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fBytes, err := ioutil.ReadFile(tt.inputFilePath)
			require.NoError(t, err)

			objects, err := parsers.ParseJSONFileWithFunc(fBytes, tt.parseFunc)
			require.NoError(t, err)

			actual, _, failed, skipped, err := p.ProcessEvents("testfile", objects, map[string]bool{}, false)
			require.NoError(t, err)

			if len(tt.expectedSkipped) > 0 {
				require.Equal(t, len(tt.expectedSkipped), len(skipped.Events), "Skipped objects quantity isn't equal")
				for i, skippedObj := range skipped.Events {
					test.ObjectsEqual(t, tt.expectedSkipped[i], *skippedObj)
				}
			} else {
				require.Empty(t, skipped.Events)
			}

			if len(tt.expectedFailed) > 0 {
				require.Equal(t, len(tt.expectedFailed), len(failed.Events), "Failed objects quantity isn't equal")
				for i, failedObj := range failed.Events {
					test.ObjectsEqual(t, tt.expectedFailed[i], *failedObj)
				}
			} else {
				require.Empty(t, failed.Events)
			}

			require.Equal(t, len(tt.expected), len(actual), "Result sizes aren't equal")

			for k, v := range actual {
				expectedUnit := tt.expected[k]
				require.NotNil(t, expectedUnit, k, "doesn't exist in actual result")
				test.ObjectsEqual(t, expectedUnit.FileName, v.FileName, k+" results filenames aren't equal")
				test.ObjectsEqual(t, expectedUnit.payload, v.payload, k+" results payloads aren't equal")
				test.ObjectsEqual(t, expectedUnit.BatchHeader, v.BatchHeader, k+" results data schemas aren't equal")

			}
		})
	}
}

func TestProcessFact(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)

	err := appconfig.Init(false, "")
	require.NoError(t, err)

	testTime, _ := time.Parse(timestamp.Layout, "2020-08-02T18:23:58.057807Z")

	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.01,
		Lon:     22.02,
		Zip:     "14101",
		Region:  "",
	}

	tests := []struct {
		name                string
		input               map[string]interface{}
		expectedBatchHeader *BatchHeader
		expectedObject      events.Event
		expectedErr         string
	}{
		{
			"Empty input event - error",
			map[string]interface{}{},
			nil,
			map[string]interface{}{},
			"error extracting table name: _timestamp field doesn't exist",
		},
		{
			"input without ip and ua ok",
			map[string]interface{}{"_timestamp": "2020-08-02T18:23:58.057807Z"},
			&BatchHeader{TableName: "events_2020_08", Fields: Fields{
				"_timestamp": NewField(typing.TIMESTAMP)}},
			events.Event{"_timestamp": testTime},
			"",
		},
		{
			"input with ip and ua ok",
			map[string]interface{}{
				"_timestamp": "2020-08-02T18:23:58.057807Z",
				"field1": map[string]interface{}{
					"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
					"ip": "10.10.10.10",
				},
			},
			&BatchHeader{TableName: "events_2020_08", Fields: Fields{
				"_timestamp":           NewField(typing.TIMESTAMP),
				"field2_ip":            NewField(typing.STRING),
				"field2_ua":            NewField(typing.STRING),
				"field3_device_family": NewField(typing.STRING),
				"field3_os_family":     NewField(typing.STRING),
				"field3_os_version":    NewField(typing.STRING),
				"field3_ua_family":     NewField(typing.STRING),
				"field3_ua_version":    NewField(typing.STRING),
				"field4_city":          NewField(typing.STRING),
				"field4_country":       NewField(typing.STRING),
				"field4_latitude":      NewField(typing.FLOAT64),
				"field4_longitude":     NewField(typing.FLOAT64),
				"field4_zip":           NewField(typing.STRING),
			}},
			events.Event{
				"_timestamp":           testTime,
				"field2_ip":            "10.10.10.10",
				"field2_ua":            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				"field3_device_family": "PK",
				"field3_os_family":     "Windows",
				"field3_os_version":    "95",
				"field3_ua_family":     "Chrome",
				"field3_ua_version":    "1.0.0",
				"field4_city":          "New York",
				"field4_country":       "US",
				"field4_latitude":      79.01,
				"field4_longitude":     22.02,
				"field4_zip":           "14101",
			},
			"",
		},
		{
			"input fields exceed the name len limit",
			map[string]interface{}{
				"_timestamp":                    "2020-08-02T18:23:58.057807Z",
				"root_field_with_very_big_name": 123,
				"rootfieldwithverybigname":      224,
				"root_object_with_big_name": map[string]interface{}{
					"innder_object_with_big_name": map[string]interface{}{
						"field_with_big_name": 1233,
						"field":               2244,
					},
				},
			},
			&BatchHeader{TableName: "events_2020_08", Fields: Fields{
				"_timestamp":           NewField(typing.TIMESTAMP),
				"fieldwithverybigname": NewField(typing.INT64),
				"ro_fi_wi_ve_big_name": NewField(typing.INT64),
				"na_in_ob_wi_bi_na_fi": NewField(typing.INT64),
				"wi_bi_na_fi_wi_bi_na": NewField(typing.INT64),
			}},
			events.Event{
				"_timestamp":           testTime,
				"fieldwithverybigname": 224,
				"na_in_ob_wi_bi_na_fi": 2244,
				"ro_fi_wi_ve_big_name": 123,
				"wi_bi_na_fi_wi_bi_na": 1233,
			},
			"",
		},
	}

	err = appconfig.Init(false, "")
	require.NoError(t, err)

	appconfig.Instance.UaResolver = useragent.Mock{}
	geoService := geo.NewTestService(geo.Mock{"10.10.10.10": geoDataMock})
	uaRule, err := enrichment.NewRule(&enrichment.RuleConfig{
		Name: enrichment.UserAgentParse,
		From: "/field1/ua",
		To:   "/field3",
	}, nil, "")
	require.NoError(t, err)
	ipRule, err := enrichment.NewRule(&enrichment.RuleConfig{
		Name: enrichment.IPLookup,
		From: "/field1/ip",
		To:   "/field4",
	}, geoService, "")
	require.NoError(t, err)

	keepUnmapped := true
	fieldMapper, _, err := NewFieldMapper(&config.Mapping{
		KeepUnmapped: &keepUnmapped,
		Fields:       []config.MappingField{{Src: "/field1", Dst: "/field2", Action: config.MOVE}},
	})
	require.NoError(t, err)

	destination := &config.DestinationConfig{Type: "google_analytics", BreakOnError: false,
		DataLayout: &config.DataLayout{Transform: ""}}
	p, err := NewProcessor("test", destination, false, `events_{{._timestamp.Format "2006_01"}}`, fieldMapper, []enrichment.Rule{uaRule, ipRule}, NewFlattener(), NewTypeResolver(), identifiers.NewUniqueID("/eventn_ctx/event_id"), 20, "new", false)
	require.NoError(t, err)
	err = p.InitJavaScriptTemplates()
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			envelopes, err := p.ProcessEvent(tt.input, false)

			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, 1, len(envelopes), "Expected 1 object")
				batchHeader := envelopes[0].Header
				actual := envelopes[0].Event
				test.ObjectsEqual(t, tt.expectedBatchHeader, batchHeader, "BatchHeader results aren't equal")
				test.ObjectsEqual(t, tt.expectedObject, actual, "Processed objects aren't equal")
			}
		})
	}
}

func TestProcessTransform(t *testing.T) {
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)
	nodeFactory, err := node.NewFactory(1, 20, 200, nil)
	if err != nil {
		t.Fatal(err)
	}

	templates.SetScriptFactory(nodeFactory)
	err = appconfig.Init(false, "")
	require.NoError(t, err)

	tests := []struct {
		name            string
		input           map[string]interface{}
		expectedObjects []events.Event
		expectedTables  []string
		expectedErr     string
	}{
		{
			"simple transform 1",
			map[string]interface{}{"event_type": "site_page", "url": "https://jitsu.com", "field1": "somedata"},
			[]events.Event{{"event": "pageview", "url": "https://jitsu.com"}},
			[]string{"events"},
			"",
		},
		{
			"simple transform 2",
			map[string]interface{}{"event_type": "indentify", "user": map[string]interface{}{"email": "hello@jitsu.com"}, "url": "https://jitsu.com", "field1": "somedata"},
			[]events.Event{{"event": "indentify", "userid": "hello@jitsu.com"}},
			[]string{"events"},
			"",
		},
		{
			"skip",
			map[string]interface{}{"event_type": "indentify", "user": map[string]interface{}{"anon": "123"}, "url": "https://jitsu.com", "field1": "somedata"},
			[]events.Event{},
			[]string{},
			"Transform or table name filter marked object to be skipped. This object will be skipped.",
		},
		{
			"transform with table name",
			map[string]interface{}{"event_type": "to_the_table", "url": "https://jitsu.com", "field1": "somedata"},
			[]events.Event{{"event_type": "to_the_table", "url": "https://jitsu.com", "field1": "somedata"}},
			[]string{"to_the_table"},
			"",
		},
		{
			"multiple events",
			map[string]interface{}{"event_type": "multiply", "eventn_ctx_event_id": "a1024", "url": "https://jitsu.com", "conversions": 3, "field1": "somedata"},
			[]events.Event{{"event": "conversion", "url": "https://jitsu.com"}, {"event": "conversion", "eventn_ctx_event_id": "a1024_1", "url": "https://jitsu.com"}, {"event": "conversion", "eventn_ctx_event_id": "a1024_2", "url": "https://jitsu.com"}},
			[]string{"conversion_0", "conversion_1", "conversion_2"},
			"",
		},
		{
			"react_style",
			map[string]interface{}{"event_type": "react_style", "eventn_ctx_event_id": "a1024", "b": true},
			[]events.Event{{"event_type": "react_style", "eventn_ctx_event_id": "a1024", "b": true, "bb": true}},
			[]string{"events"},
			"",
		},
		{
			"react_style_skip_all",
			map[string]interface{}{"event_type": "react_style", "eventn_ctx_event_id": "a1024", "b": false},
			[]events.Event{},
			[]string{},
			"Transform or table name filter marked object to be skipped. This object will be skipped.",
		},
		{
			"segment",
			map[string]interface{}{"event_type": "user_identify", "source_ip": "127.0.0.1", "url": "https://jitsu.com", "app": "jitsu"},
			[]events.Event{{"context_ip": "127.0.0.1", "app": "jitsu", "url": "https://jitsu.com"}},
			[]string{"identifies"},
			"",
		},
	}
	appconfig.Init(false, "")

	fieldMapper := DummyMapper{}
	transformExpression := `
switch ($.event_type) {
    case "site_page":
        return {
            event: "pageview",
            url: $.url
        }
    case "indentify":
        if ($.user?.email) {
            return {
                    event: "indentify",
                    userid: $.user.email
                }
        } else {
            return null
        }
    case "multiply":
        let convs = new Array();
        for (i = 0; i < $.conversions; i++) {
            convs.push({
                          event: "conversion",
                          [TABLE_NAME]: "conversion_" + i,
                          url: $.url
                        })
        }
        return convs
    case "react_style":
		return [
			null,
			undefined,
			false,
			$.b && {
				bb: $.b,
				...$,
			}
		]
	case "user_identify":
		return toSegment($)
    default:
        return {...$, [TABLE_NAME]: $.event_type}
}
`
	destination := &config.DestinationConfig{Type: "google_analytics", BreakOnError: false,
		DataLayout: &config.DataLayout{Transform: transformExpression}}
	p, err := NewProcessor("test", destination, false, `events`, fieldMapper, []enrichment.Rule{}, NewFlattener(), NewTypeResolver(), identifiers.NewUniqueID("/eventn_ctx/event_id"), 20, "new", false)
	require.NoError(t, err)
	err = p.InitJavaScriptTemplates()
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			envelopes, err := p.ProcessEvent(tt.input, false)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, len(tt.expectedObjects), len(envelopes), "Number of expected objects doesnt match.")
				for i := 0; i < len(envelopes); i++ {
					actual := envelopes[i].Event
					expected := tt.expectedObjects[i]
					table := envelopes[i].Header.TableName
					expectedTable := tt.expectedTables[i]
					//logging.Infof("input: %v expected: %v actual: %v", tt.input, expected, actual)
					//logging.Infof("input: %v expected table: %v actual: %v", tt.input, expectedTable, table)
					test.ObjectsEqual(t, expected, actual, "Processed objects aren't equal")
					test.ObjectsEqual(t, expectedTable, table, "Table names aren't equal")
				}

			}
		})
	}
}

func TestCutName(t *testing.T) {
	require.Equal(t, "ountry", cutName("firstnamelastnamemiddlenamecountry", 6))
	require.Equal(t, "test", cutName("test", 12))
	require.Equal(t, "fi_la_mi_co", cutName("firstname_lastname_middlename_country", 12))
	require.Equal(t, "fi_la_mi_co", cutName("fi_lastname_middlename_country", 12))
	require.Equal(t, "fi_la_mi_co", cutName("fi_la_middlename_country", 12))
	require.Equal(t, "fi_la_mi_co", cutName("fi_lastname_mi_country", 12))
	require.Equal(t, "_la_mi_co_ci", cutName("fi_la_mi_co_ci", 12))
}
