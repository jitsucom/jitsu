package main

import (
	"encoding/json"
	"testing"
)

func sameIds(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestStreamSelectorUnmarshal(t *testing.T) {
	tests := []struct {
		name            string
		input           string
		wantIds         []string
		wantIdsSet      bool
		wantConnections map[string][]string
		wantConnsSet    bool
		wantErr         bool
	}{
		{
			name:       "list of ids",
			input:      `["s1", "s2"]`,
			wantIds:    []string{"s1", "s2"},
			wantIdsSet: true,
		},
		{
			name:       "empty list stays an empty selection",
			input:      `[]`,
			wantIdsSet: true,
		},
		{
			name:            "map of lists",
			input:           `{"s1": ["c1", "c2"]}`,
			wantConnections: map[string][]string{"s1": {"c1", "c2"}},
			wantConnsSet:    true,
		},
		{
			name:            "bare connection id normalizes to a list",
			input:           `{"s1": "c1"}`,
			wantConnections: map[string][]string{"s1": {"c1"}},
			wantConnsSet:    true,
		},
		{
			name:            "wildcards",
			input:           `{"s1": ["*", "c1"], "*": "*"}`,
			wantConnections: map[string][]string{"s1": {"*", "c1"}, "*": {"*"}},
			wantConnsSet:    true,
		},
		{
			name:            "empty map stays an empty selection",
			input:           `{}`,
			wantConnections: map[string][]string{},
			wantConnsSet:    true,
		},
		{
			name:  "null is no selection at all",
			input: `null`,
		},
		{name: "number connection id", input: `{"s1": 42}`, wantErr: true},
		{name: "number inside the list", input: `{"s1": ["c1", 42]}`, wantErr: true},
		{name: "scalar instead of list or map", input: `"s1"`, wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var selector StreamSelector
			err := json.Unmarshal([]byte(tt.input), &selector)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected an error for %s", tt.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("unmarshal %s: %v", tt.input, err)
			}
			// nil vs empty carries meaning: absent selects everything, empty selects nothing
			if (selector.Ids != nil) != tt.wantIdsSet {
				t.Errorf("Ids set = %v (%v), want %v", selector.Ids != nil, selector.Ids, tt.wantIdsSet)
			}
			if (selector.Connections != nil) != tt.wantConnsSet {
				t.Errorf("Connections set = %v (%v), want %v", selector.Connections != nil, selector.Connections, tt.wantConnsSet)
			}
			if !sameIds(selector.Ids, tt.wantIds) {
				t.Errorf("Ids = %v, want %v", selector.Ids, tt.wantIds)
			}
			if len(selector.Connections) != len(tt.wantConnections) {
				t.Fatalf("Connections = %v, want %v", selector.Connections, tt.wantConnections)
			}
			for streamId, want := range tt.wantConnections {
				if !sameIds(selector.Connections[streamId], want) {
					t.Errorf("Connections[%q] = %v, want %v", streamId, selector.Connections[streamId], want)
				}
			}
		})
	}
}

// The workers read the config from a ConfigMap, so the shape the selector
// marshals to is what decides their behavior.
func TestStreamSelectorMarshal(t *testing.T) {
	tests := []struct {
		name     string
		selector StreamSelector
		want     string
	}{
		{name: "unset", selector: StreamSelector{}, want: `null`},
		{name: "ids", selector: StreamSelector{Ids: []string{"s1", "s2"}}, want: `["s1","s2"]`},
		{name: "empty ids stay an empty list", selector: StreamSelector{Ids: []string{}}, want: `[]`},
		{
			name:     "connections",
			selector: StreamSelector{Connections: map[string][]string{"s1": {"c1"}}},
			want:     `{"s1":["c1"]}`,
		},
		{
			name:     "empty map stays an empty map",
			selector: StreamSelector{Connections: map[string][]string{}},
			want:     `{}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(tt.selector)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			if string(got) != tt.want {
				t.Errorf("marshal = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestStreamSelectorRoundTripThroughJobConfig(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{name: "ids", input: `["s1","s2"]`, want: `["s1","s2"]`},
		{name: "map", input: `{"s1":["c1"]}`, want: `{"s1":["c1"]}`},
		{name: "bare id normalizes to a list", input: `{"s1":"c1"}`, want: `{"s1":["c1"]}`},
		{name: "empty map survives", input: `{}`, want: `{}`},
		{name: "empty list survives", input: `[]`, want: `[]`},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var request ReprocessingStartRequest
			if err := json.Unmarshal([]byte(`{"stream_ids":`+tt.input+`}`), &request); err != nil {
				t.Fatalf("unmarshal request: %v", err)
			}
			config := ReprocessingJobConfig{StreamIds: request.StreamIds}
			encoded, err := json.Marshal(config)
			if err != nil {
				t.Fatalf("marshal config: %v", err)
			}
			var decoded map[string]json.RawMessage
			if err := json.Unmarshal(encoded, &decoded); err != nil {
				t.Fatalf("decode config: %v", err)
			}
			if got := string(decoded["stream_ids"]); got != tt.want {
				t.Errorf("stream_ids in the workers' config = %s, want %s", got, tt.want)
			}
		})
	}
}

func TestGCSAndEventsRoundTripThroughJobConfig(t *testing.T) {
	var request ReprocessingStartRequest
	if err := json.Unmarshal([]byte(`{"gcs_path":"gs://events/failover/","events":["page","signup"]}`), &request); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}
	config := ReprocessingJobConfig{GCSPath: request.GCSPath, Events: request.Events}
	encoded, err := json.Marshal(config)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	var decoded struct {
		GCSPath string   `json:"gcs_path"`
		Events  []string `json:"events"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("decode config: %v", err)
	}
	if decoded.GCSPath != "gs://events/failover/" {
		t.Errorf("gcs_path = %q", decoded.GCSPath)
	}
	if !sameIds(decoded.Events, []string{"page", "signup"}) {
		t.Errorf("events = %v", decoded.Events)
	}
}
