package storages

import (
	"github.com/gomodule/redigo/redis"
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

type Migration interface {
	Run(conn redis.Conn) error
}

type Object interface {
	ObjectType() string
}

type OnCreateHandler interface {
	Object
	OnCreate(id string)
}

type OnUpdateHandler interface {
	OnUpdate()
}
