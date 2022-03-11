package migration

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/gomodule/redigo/redis"
	"github.com/mitchellh/mapstructure"
	"github.com/pkg/errors"
)

const (
	usersInfoKey        = "config#users_info"
	projectSettingsKey  = "config#project_settings"
	userProjectRelation = "user_project"
)

var MultiProjectSupport = multiProjectSupport{}

type multiProjectSupport struct{}

func (multiProjectSupport) Run(conn redis.Conn) error {
	users, err := redis.StringMap(conn.Do("HGETALL", usersInfoKey))
	if err != nil {
		return errors.Wrap(err, "get all users")
	}

	for userID, userValue := range users {
		user := make(map[string]interface{})
		if err := json.Unmarshal([]byte(userValue), &user); err != nil {
			return errors.Wrapf(err, "unmarshal user info value for %s", userID)
		}

		if projectValue, ok := user["_project"]; ok {
			project := make(map[string]interface{}, 4)
			if err := mapstructure.Decode(projectValue, &project); err != nil {
				return errors.Wrapf(err, "decode project for user %s", userID)
			}

			delete(project, "$type")
			for key, value := range project {
				delete(project, key)
				project[strings.TrimLeft(key, "_")] = value
			}

			projectSettings, err := redis.Bytes(conn.Do("HGET", projectSettingsKey, project["id"]))
			switch err {
			case nil:
				// merge existing project settings into user project
				if err := json.Unmarshal(projectSettings, &project); err != nil {
					return errors.Wrapf(err, "unmarshal project settings for %s", project["id"])
				}

			case redis.ErrNil:
				// this is fine

			default:
				return errors.Wrapf(err, "get project settings for %s", project["id"])
			}

			// update project (settings)
			if projectValue, err := json.Marshal(project); err != nil {
				return errors.Wrapf(err, "marshal project %s", project["id"])
			} else if _, err := conn.Do("HSET", projectSettingsKey, project["id"], projectValue); err != nil {
				return errors.Wrapf(err, "update project %s", project["id"])
			}

			// link user to project
			relationKey := fmt.Sprintf("relation#%s:%s", userProjectRelation, userID)
			if _, err := conn.Do("SADD", relationKey, project["id"]); err != nil {
				return errors.Wrapf(err, "link project %s to user %s", project["id"], userID)
			}

		}
	}

	return nil
}
