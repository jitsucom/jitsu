package storages

import (
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/timestamp"
)

//PatchPayload is a dto for patch request
type PatchPayload struct {
	ObjectArrayPath string                 `json:"arrayPath,omitempty"`
	ObjectMeta      *ObjectMeta            `json:"object,omitempty"`
	Patch           map[string]interface{} `json:"patch,omitempty"`
}

//ObjectMeta is a dto for object meta information such as identifier path
type ObjectMeta struct {
	IDFieldPath string `json:"idFieldPath,omitempty"`
	Value       string `json:"value,omitempty"`
}

var UserInfoTimestampFormat = "2006-01-02T15:04:05.000Z"

type Migration interface {
	Run(conn redis.Conn) error
}

type CollectionItem interface {
	Collection() string
}

type OnCreateHandler interface {
	CollectionItem
	OnCreate(id string)
}

type OnUpdateHandler interface {
	OnUpdate()
}

type Project struct {
	openapi.Project
	openapi.ProjectSettings
}

func (p *Project) Collection() string {
	return "project_settings"
}

func (p *Project) OnCreate(id string) {
	p.Id = id
	requiresSetup := true
	p.RequiresSetup = &requiresSetup
}

type RedisUserInfo openapi.UserInfo

func (i *RedisUserInfo) OnCreate(id string) {
	i.Uid = id
	i.Created = timestamp.Now().Format(UserInfoTimestampFormat)
}

func (i *RedisUserInfo) OnUpdate() {
	value := timestamp.Now().Format(UserInfoTimestampFormat)
	i.LastUpdated = &value
}

func (*RedisUserInfo) Collection() string {
	return "users_info"
}
