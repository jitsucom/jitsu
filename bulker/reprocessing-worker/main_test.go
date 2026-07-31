package main

import (
	"encoding/json"
	"testing"
)

// jobConfig builds a job config the way the worker reads it: parsed from the
// ConfigMap JSON, so values arrive as interface{} of the generic JSON types.
func jobConfig(t *testing.T, raw string) map[string]interface{} {
	t.Helper()
	var config map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		t.Fatalf("bad test fixture %s: %v", raw, err)
	}
	return config
}

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

func TestParseConnectionRules(t *testing.T) {
	tests := []struct {
		name          string
		config        string
		wantSelected  bool
		wantMapForm   bool
		wantIds       []string
		wantPerStream map[string][]string
		wantFilter    bool
	}{
		{
			name:   "absent selector reprocesses everything",
			config: `{}`,
		},
		{
			name:         "plain list of ids",
			config:       `{"stream_ids": ["s1", "s2"]}`,
			wantSelected: true,
			wantIds:      []string{"s1", "s2"},
		},
		{
			name:         "empty list selects nothing",
			config:       `{"stream_ids": []}`,
			wantSelected: true,
		},
		{
			name:          "map of lists",
			config:        `{"stream_ids": {"s1": ["c1", "c2"]}}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{"s1": {"c1", "c2"}},
		},
		{
			name:          "bare connection id is shorthand for a single-element list",
			config:        `{"stream_ids": {"s1": "c1"}}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{"s1": {"c1"}},
		},
		{
			name:          "wildcards in keys and values",
			config:        `{"stream_ids": {"s1": ["*", "c1"], "*": "*"}}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{"s1": {"*", "c1"}, "*": {"*"}},
		},
		{
			name:          "empty map selects nothing",
			config:        `{"stream_ids": {}}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{},
		},
		{
			name:          "filter mode",
			config:        `{"stream_ids": {"s1": ["c1"]}, "connections_filter": true}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{"s1": {"c1"}},
			wantFilter:    true,
		},
		{
			name:          "non-string connection ids are ignored",
			config:        `{"stream_ids": {"s1": ["c1", 42]}}`,
			wantSelected:  true,
			wantMapForm:   true,
			wantPerStream: map[string][]string{"s1": {"c1"}},
		},
		{
			name:         "retired connection_ids field has no effect",
			config:       `{"stream_ids": ["s1"], "connection_ids": ["c1"]}`,
			wantSelected: true,
			wantIds:      []string{"s1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rules := parseConnectionRules(jobConfig(t, tt.config))
			if rules.selected != tt.wantSelected {
				t.Errorf("selected = %v, want %v", rules.selected, tt.wantSelected)
			}
			if rules.mapForm != tt.wantMapForm {
				t.Errorf("mapForm = %v, want %v", rules.mapForm, tt.wantMapForm)
			}
			if rules.filter != tt.wantFilter {
				t.Errorf("filter = %v, want %v", rules.filter, tt.wantFilter)
			}
			if !sameIds(rules.ids, tt.wantIds) {
				t.Errorf("ids = %v, want %v", rules.ids, tt.wantIds)
			}
			if len(rules.perStream) != len(tt.wantPerStream) {
				t.Fatalf("perStream = %v, want %v", rules.perStream, tt.wantPerStream)
			}
			for streamId, want := range tt.wantPerStream {
				if !sameIds(rules.perStream[streamId], want) {
					t.Errorf("perStream[%q] = %v, want %v", streamId, rules.perStream[streamId], want)
				}
			}
			// the map form must stay distinguishable from "no selector" even when empty
			if tt.wantMapForm && rules.perStream == nil {
				t.Error("map form lost: perStream is nil")
			}
		})
	}
}

func TestConnectionRulesMatches(t *testing.T) {
	tests := []struct {
		name     string
		config   string
		sourceId string
		slug     string
		want     bool
	}{
		{name: "no selector matches any stream", config: `{}`, sourceId: "s1", want: true},
		{name: "listed id", config: `{"stream_ids": ["s1"]}`, sourceId: "s1", want: true},
		{name: "listed by slug", config: `{"stream_ids": ["my-slug"]}`, sourceId: "s1", slug: "my-slug", want: true},
		{name: "unlisted id", config: `{"stream_ids": ["s1"]}`, sourceId: "s2", want: false},
		{name: "empty list matches nothing", config: `{"stream_ids": []}`, sourceId: "s1", want: false},
		{name: "map key", config: `{"stream_ids": {"s1": "c1"}}`, sourceId: "s1", want: true},
		{name: "map key by slug", config: `{"stream_ids": {"my-slug": "c1"}}`, sourceId: "s1", slug: "my-slug", want: true},
		{name: "stream missing from map", config: `{"stream_ids": {"s1": "c1"}}`, sourceId: "s2", want: false},
		{name: "wildcard key matches any stream", config: `{"stream_ids": {"*": "c1"}}`, sourceId: "s2", want: true},
		{name: "empty map matches nothing", config: `{"stream_ids": {}}`, sourceId: "s1", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rules := parseConnectionRules(jobConfig(t, tt.config))
			if got := rules.matches(tt.sourceId, tt.slug); got != tt.want {
				t.Errorf("matches(%q, %q) = %v, want %v", tt.sourceId, tt.slug, got, tt.want)
			}
		})
	}
}

func TestConnectionRulesLookup(t *testing.T) {
	rules := parseConnectionRules(jobConfig(t, `{"stream_ids": {"s1": "c1", "my-slug": "c2", "*": "c3"}}`))

	tests := []struct {
		name      string
		sourceId  string
		slug      string
		want      []string
		wantFound bool
	}{
		{name: "exact id", sourceId: "s1", want: []string{"c1"}, wantFound: true},
		{name: "id wins over slug", sourceId: "s1", slug: "my-slug", want: []string{"c1"}, wantFound: true},
		{name: "slug fallback", sourceId: "unknown", slug: "my-slug", want: []string{"c2"}, wantFound: true},
		{name: "wildcard fallback", sourceId: "unknown", want: []string{"c3"}, wantFound: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, found := rules.lookup(tt.sourceId, tt.slug)
			if found != tt.wantFound || !sameIds(got, tt.want) {
				t.Errorf("lookup(%q, %q) = %v, %v; want %v, %v", tt.sourceId, tt.slug, got, found, tt.want, tt.wantFound)
			}
		})
	}

	t.Run("no wildcard means unlisted streams are not found", func(t *testing.T) {
		noWildcard := parseConnectionRules(jobConfig(t, `{"stream_ids": {"s1": "c1"}}`))
		if _, found := noWildcard.lookup("s2", ""); found {
			t.Error("lookup found a rule for an unlisted stream")
		}
	})

	t.Run("plain form has no connection rules", func(t *testing.T) {
		plain := parseConnectionRules(jobConfig(t, `{"stream_ids": ["s1"]}`))
		if _, found := plain.lookup("s1", ""); found {
			t.Error("plain form returned a connection rule")
		}
	})
}

func TestResolveConnections(t *testing.T) {
	mapped := []string{"m1", "m2"}

	tests := []struct {
		name    string
		rule    []string
		hasRule bool
		filter  bool
		mapped  []string
		want    []string
	}{
		{
			name:   "no rule keeps the mapped connections",
			mapped: mapped,
			want:   []string{"m1", "m2"},
		},
		{
			name:    "override replaces the mapping",
			rule:    []string{"c1"},
			hasRule: true,
			mapped:  mapped,
			want:    []string{"c1"},
		},
		{
			name:    "override sends to the listed ids regardless of the mapping",
			rule:    []string{"c1", "c2"},
			hasRule: true,
			mapped:  mapped,
			want:    []string{"c1", "c2"},
		},
		{
			name:    "filter keeps listed mapped connections",
			rule:    []string{"m1"},
			hasRule: true,
			filter:  true,
			mapped:  mapped,
			want:    []string{"m1"},
		},
		{
			name:    "filter drops everything when nothing listed is mapped",
			rule:    []string{"c1"},
			hasRule: true,
			filter:  true,
			mapped:  mapped,
			want:    nil,
		},
		{
			name:    "wildcard in override expands to the mapping",
			rule:    []string{"*"},
			hasRule: true,
			mapped:  mapped,
			want:    []string{"m1", "m2"},
		},
		{
			name:    "wildcard in filter passes the whole mapping",
			rule:    []string{"*"},
			hasRule: true,
			filter:  true,
			mapped:  mapped,
			want:    []string{"m1", "m2"},
		},
		{
			name:    "wildcard plus an extra id unions them",
			rule:    []string{"*", "c1"},
			hasRule: true,
			mapped:  mapped,
			want:    []string{"m1", "m2", "c1"},
		},
		{
			name:    "wildcard union deduplicates",
			rule:    []string{"*", "m1"},
			hasRule: true,
			mapped:  mapped,
			want:    []string{"m1", "m2"},
		},
		{
			name:    "empty rule in override drops the event",
			rule:    []string{},
			hasRule: true,
			mapped:  mapped,
			want:    nil,
		},
		{
			name:    "empty rule in filter drops the event",
			rule:    []string{},
			hasRule: true,
			filter:  true,
			mapped:  mapped,
			want:    nil,
		},
		{
			name:    "wildcard in override with no mapping yields the explicit ids",
			rule:    []string{"*", "c1"},
			hasRule: true,
			want:    []string{"c1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveConnections(tt.rule, tt.hasRule, tt.filter, tt.mapped)
			if !sameIds(got, tt.want) {
				t.Errorf("resolveConnections(%v, %v, filter=%v, %v) = %v, want %v",
					tt.rule, tt.hasRule, tt.filter, tt.mapped, got, tt.want)
			}
		})
	}
}

func TestNeedsMappedConnections(t *testing.T) {
	tests := []struct {
		name    string
		rule    []string
		hasRule bool
		filter  bool
		want    bool
	}{
		{name: "no rule needs the mapping", want: true},
		{name: "filter mode needs the mapping", rule: []string{"c1"}, hasRule: true, filter: true, want: true},
		{name: "wildcard needs the mapping", rule: []string{"*"}, hasRule: true, want: true},
		{name: "plain override does not", rule: []string{"c1"}, hasRule: true, want: false},
		{name: "empty override rule does not", rule: []string{}, hasRule: true, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := needsMappedConnections(tt.rule, tt.hasRule, tt.filter); got != tt.want {
				t.Errorf("needsMappedConnections(%v, %v, %v) = %v, want %v", tt.rule, tt.hasRule, tt.filter, got, tt.want)
			}
		})
	}
}
