package jsonutils

import (
	"github.com/jitsucom/jitsu/server/test"
	"testing"
)

func TestMerge(t *testing.T) {
	tests := []struct {
		name        string
		inputObject map[string]interface{}
		inputPatch  map[string]interface{}
		expected    map[string]interface{}
	}{
		{
			"all objects is nil",
			nil,
			nil,
			nil,
		},
		{
			"input object is nil",
			nil,
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
		},
		{
			"patch object is nil",

			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
			nil,
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
		},
		{
			"two objects",
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
			map[string]interface{}{
				"field2": map[string]interface{}{
					"subfield2": 999,
					"subfield3": map[string]interface{}{
						"subsubfield1": "1111",
					},
				},
				"field3": "subfield3",
				"field4": map[string]interface{}{
					"subfield4": 566,
				},
			},
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 999,
					"subfield3": map[string]interface{}{
						"subsubfield1": "1111",
					},
				},
				"field3": "subfield3",
				"field4": map[string]interface{}{
					"subfield4": 566,
				},
			},
		},
		{
			"deep two objects",
			map[string]interface{}{
				"field1": "keep",
				"field2": map[string]interface{}{
					"subfield1": "update",
					"subfield2": "delete",
					"subfield3": map[string]interface{}{
						"sub_subfield0": "keep",
						"sub_subfield1": "update",
						"sub_subfield2": "delete",
						"sub_subfield3": map[string]interface{}{
							"sub_sub_field3": "keep",
							"sub_sub_field4": map[string]interface{}{},
							"sub_sub_field5": "delete",
						},
					},
				},
			},
			map[string]interface{}{
				"field2": map[string]interface{}{
					"subfield1": "newvalue",
					"subfield2": nil,
					"subfield3": map[string]interface{}{
						"sub_subfield1": "newvalue",
						"sub_subfield2": nil,
						"sub_subfield3": map[string]interface{}{
							"sub_sub_field5": nil,
						},
					},
				},
			},
			map[string]interface{}{
				"field1": "keep",
				"field2": map[string]interface{}{
					"subfield1": "newvalue",
					"subfield3": map[string]interface{}{
						"sub_subfield0": "keep",
						"sub_subfield1": "newvalue",
						"sub_subfield3": map[string]interface{}{
							"sub_sub_field3": "keep",
							"sub_sub_field4": map[string]interface{}{},
						},
					},
				},
			},
		},
		{
			"handle delete nil object",
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": 123,
				},
			},
			map[string]interface{}{
				"field2": nil,
				"field3": "subfield3",
				"field4": map[string]interface{}{
					"subfield4": 566,
				},
			},
			map[string]interface{}{
				"field1": "subfield1",
				"field3": "subfield3",
				"field4": map[string]interface{}{
					"subfield4": 566,
				},
			},
		},
		{
			"not delete empty object",
			map[string]interface{}{
				"field1": "subfield1",
				"field2": map[string]interface{}{
					"subfield2": map[string]interface{}{
						"subfield3": 123,
					},
				},
			},
			map[string]interface{}{
				"field3": "subfield3",
				"field2": map[string]interface{}{
					"subfield2": map[string]interface{}{
						"subfield3": nil,
					},
				},
			},
			map[string]interface{}{
				"field1": "subfield1",
				"field3": "subfield3",
				"field2": map[string]interface{}{
					"subfield2": map[string]interface{}{},
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual := Merge(tt.inputObject, tt.inputPatch)

			test.ObjectsEqual(t, tt.expected, actual, "Objects aren't equal")
		})
	}
}
