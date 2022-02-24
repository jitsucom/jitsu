package common

import (
	"github.com/mitchellh/mapstructure"
	"github.com/pkg/errors"
)

func DecodeAsJSON(source interface{}, target interface{}, zero bool) error {
	config := &mapstructure.DecoderConfig{
		TagName:    "json",
		Result:     target,
		Squash:     true,
		ZeroFields: zero,
	}

	if decoder, err := mapstructure.NewDecoder(config); err != nil {
		return errors.Wrap(err, "mapstructure.NewDecoder")
	} else if err := decoder.Decode(source); err != nil {
		return errors.Wrap(err, "mapstructure.Decode")
	} else {
		return nil
	}
}
