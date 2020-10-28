package uuid

import googleuuid "github.com/google/uuid"

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
