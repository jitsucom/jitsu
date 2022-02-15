package common

import "encoding/json"

type StringSet map[string]bool

func (s *StringSet) UnmarshalJSON(data []byte) error {
	values := make([]string, 0)
	if err := json.Unmarshal(data, &values); err != nil {
		return err
	}

	*s = StringSetFrom(values)
	return nil
}

func (s StringSet) MarshalJSON() ([]byte, error) {
	values := make([]string, 0, len(s))
	for value := range s {
		values = append(values, value)
	}

	return json.Marshal(values)
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
	for _, value := range values {
		set[value] = true
	}

	return set
}
