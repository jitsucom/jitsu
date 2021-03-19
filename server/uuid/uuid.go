package uuid

import (
	"crypto/md5"
	"fmt"
	googleuuid "github.com/google/uuid"
	"sort"
)

var mock bool

func InitMock() {
	mock = true
}

func New() string {
	if mock {
		return "mockeduuid"
	}

	return googleuuid.New().String()
}

func GetHash(m map[string]interface{}) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	return GetKeysHash(m, keys)
}

func GetKeysHash(m map[string]interface{}, keys []string) string {
	sort.Strings(keys)

	var str string
	for _, k := range keys {
		str += fmt.Sprint(m[k]) + "|"
	}

	return fmt.Sprintf("%x", md5.Sum([]byte(str)))
}
