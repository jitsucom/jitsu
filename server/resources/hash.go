package resources

import (
	"crypto/md5"
	"fmt"
	"github.com/mitchellh/hashstructure/v2"
)

var hashOptions = &hashstructure.HashOptions{SlicesAsSets: true}

func GetStringHash(value string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(value)))
}

func GetBytesHash(payload []byte) string {
	return fmt.Sprintf("%x", md5.Sum(payload))
}

func GetHash(value interface{}) (uint64, error) {
	hash, err := hashstructure.Hash(value, hashstructure.FormatV2, hashOptions)
	if err != nil {
		return 0, err
	}

	return hash, nil
}
