package common

import (
	"encoding/json"
	"strings"
)

type StringSet map[string]bool

func (s *StringSet) UnmarshalJSON(data []byte) error {
	values := make([]string, 0, strings.Count(string(data), ",")+1)
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}

	*s = StringSetFrom(values)
	return nil
}

func (s StringSet) Add(value string) {
	s[value] = true
}

func (s StringSet) AddAll(values ...string) {
	for _, value := range values {
		s.Add(value)
	}
}

func (s StringSet) MarshalJSON() ([]byte, error) {
	return json.Marshal(s.Values())
}

func (s StringSet) Values() []string {
	values := make([]string, 0, len(s))
	for value := range s {
		values = append(values, value)
	}

	return values
}

func StringSetFrom(values []string) StringSet {
	set := make(StringSet, len(values))
	set.AddAll(values...)
	return set
}
