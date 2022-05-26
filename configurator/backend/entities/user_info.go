package entities

import (
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const UserInfoTimestampFormat = "2006-01-02T15:04:05.000Z"

type UserInfo openapi.UserInfo

func (i *UserInfo) OnCreate(id string) {
	i.Uid = id
	i.Created = timestamp.Now().Format(UserInfoTimestampFormat)
}

func (i *UserInfo) OnUpdate() {
	value := timestamp.Now().Format(UserInfoTimestampFormat)
	i.LastUpdated = &value
}

func (*UserInfo) ObjectType() string {
	return "users_info"
}
