package common

import "gopkg.in/guregu/null.v3"

func NilOrString(value *string) *null.String {
	if value == nil {
		return nil
	}

	nv := null.StringFrom(*value)
	return &nv
}
