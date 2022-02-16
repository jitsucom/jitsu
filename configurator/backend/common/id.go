package common

import (
	"math/rand"
	"strings"

	"github.com/martinlindhe/base36"
)

func GenerateProjectID() string {
	return GenerateID(0)
}

func GenerateID(length int) string {
	prefix := base36.Encode(rand.Uint64())
	if len(prefix) > 2 {
		prefix = prefix[2:]
	} else {
		prefix = ""
	}

	if length > 2 && len(prefix) > length-2 {
		prefix = prefix[:length-2]
	}

	suffix := base36.Encode(rand.Uint64())
	if len(suffix) > 2 {
		suffix = suffix[2:]
	} else {
		suffix = ""
	}

	if len(suffix) > 13 {
		suffix = suffix[:13]
	}

	value := prefix + suffix
	if length > 0 && len(value) > length {
		value = value[:length]
	}

	return strings.ToLower(value)
}
