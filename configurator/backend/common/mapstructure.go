package common

import (
	"encoding/json"

	"github.com/pkg/errors"
)

// DecodeAsJSON is basically the same as mapstructure.Decode,
// but it uses stdlib encoding/json package to marshal & unmarshal value.
// This provides the benefit of "honest" struct-to-recursive map decoding.
func DecodeAsJSON(source interface{}, target interface{}) error {
	if data, err := json.Marshal(source); err != nil {
		return errors.Wrap(err, "marshal")
	} else if err := json.Unmarshal(data, &target); err != nil {
		return errors.Wrap(err, "unmarshal")
	} else {
		return nil
	}
}
