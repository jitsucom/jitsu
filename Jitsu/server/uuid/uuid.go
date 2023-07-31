package uuid

import (
	"crypto/md5"
	"fmt"
	googleuuid "github.com/google/uuid"
	"sort"
	"strings"
)

var mock bool

//InitMock initializes mock flag => New() func will return mock value everytime
func InitMock() {
	mock = true
}

//New returns uuid v4 string or the mocked value
func New() string {
	if mock {
		return "mockeduuid"
	}

	return googleuuid.New().String()
}

//NewLettersNumbers returns uuid without "-"
func NewLettersNumbers() string {
	if mock {
		return "mockeduuid"
	}

	uuidValue := googleuuid.New().String()
	return strings.ReplaceAll(uuidValue, "-", "")
}

//GetHash returns GetKeysHash result with keys from m
func GetHash(m map[string]interface{}) string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	return GetKeysHash(m, keys)
}

//GetKeysHash returns md5 hashsum of concatenated map values (sort keys before)
func GetKeysHash(m map[string]interface{}, keys []string) string {
	sort.Strings(keys)

	var str strings.Builder
	for _, k := range keys {
		str.WriteString(fmt.Sprint(m[k]))
		str.WriteRune('|')
	}

	return fmt.Sprintf("%x", md5.Sum([]byte(str.String())))
}

//GetKeysUnhashed returns keys values joined by '_'
func GetKeysUnhashed(m map[string]interface{}, keys []string) string {
	sort.Strings(keys)

	var str strings.Builder
	for i, k := range keys {
		if i > 0 {
			str.WriteRune('_')
		}
		str.WriteString(fmt.Sprint(m[k]))
	}

	return str.String()
}
