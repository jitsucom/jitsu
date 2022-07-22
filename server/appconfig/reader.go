package appconfig

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/spf13/viper"
	"os"
	"regexp"
	"strings"
)

const notsetDefaultValue = "__NOTSET_DEFAULT_VALUE__"

var templateVariablePattern = regexp.MustCompile(`\$\{env\.[\w_]+(?:\|[^\}]*)?\}`)

//Read reads config from configSourceStr that might be (HTTP URL or path to YAML/JSON file or plain JSON string)
//replaces all ${env.VAR} placeholders with OS variables
//configSourceStr might be overridden by "config_location" ENV variable
//returns err if occurred
func Read(configSourceStr string, containerizedRun bool, configNotFoundErrMsg string, appName string) error {
	viper.AutomaticEnv()

	//support OS env variables as lower case and dot divided variables e.g. SERVER_PORT as server.port
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	//overridden configuration from ENV
	overriddenConfigLocation := viper.GetString("config_location")
	if overriddenConfigLocation != "" {
		configSourceStr = overriddenConfigLocation
	}
	logging.Infof("%s config location: %s", appName, configSourceStr)
	var payload *resources.ResponsePayload
	var err error
	if strings.HasPrefix(configSourceStr, "http://") || strings.HasPrefix(configSourceStr, "https://") {
		payload, err = resources.LoadFromHTTP(configSourceStr, "")
	} else if strings.HasPrefix(configSourceStr, "{") && strings.HasSuffix(configSourceStr, "}") {
		jsonContentType := resources.JSONContentType
		payload = &resources.ResponsePayload{Content: []byte(configSourceStr), ContentType: &jsonContentType}
	} else if configSourceStr != "" {
		payload, err = resources.LoadFromFile(configSourceStr, "")
	} else {
		//run without config from sources
		logging.ConfigWarn = configNotFoundErrMsg
	}

	if err != nil {
		return handleConfigErr(err, containerizedRun, configNotFoundErrMsg)
	}

	if payload != nil && payload.ContentType != nil {
		viper.SetConfigType(string(*payload.ContentType))
	} else {
		//default content type
		viper.SetConfigType("json")
	}

	if payload != nil {
		err = viper.ReadConfig(bytes.NewBuffer(payload.Content))
		if err != nil {
			errWithContext := fmt.Errorf("Error reading/parsing config from %s: %v", configSourceStr, err)
			return handleConfigErr(errWithContext, containerizedRun, configNotFoundErrMsg)
		}
	}

	//resolve ${env.VAR} placeholders from config values
	envPlaceholderValues := map[string]interface{}{}
	for _, k := range viper.AllKeys() {
		value := viper.Get(k)
		enrichWithResolvedPlaceholders(k, value, envPlaceholderValues)
	}

	//merge back into viper
	if len(envPlaceholderValues) > 0 {
		if err := viper.MergeConfigMap(envPlaceholderValues); err != nil {
			logging.Fatalf("Error merging env values into viper config: %v", err)
		}
	}

	return nil
}

func regexReplace(value string) string {
	envExpression := strings.TrimSuffix(strings.TrimPrefix(value, "${"), "}")

	var varsNotFound []string
	//alternatives in case of ${env.VAR1|env.VAR2|default_value}
	expressionValues := strings.Split(envExpression, "|")
	for _, expressionValue := range expressionValues {
		if strings.HasPrefix(expressionValue, "env.") {
			//from env
			envVarName := strings.TrimPrefix(expressionValue, "env.")
			if envVarValue := os.Getenv(envVarName); envVarValue != "" {
				return envVarValue
			}

			//not found
			varsNotFound = append(varsNotFound, envVarName)
		} else {
			//constant
			return expressionValue
		}
	}

	//not found
	if len(varsNotFound) == 1 {
		logging.Fatalf("Mandatory env variable was not found: %s", varsNotFound[0])
	} else {
		logging.Fatalf("No one of env variables [%s] were not found. Please set any", strings.Join(varsNotFound, " or "))
	}

	return ""
}

func enrichWithResolvedPlaceholders(key string, value interface{}, result map[string]interface{}) {
	var res interface{}
	switch typed := value.(type) {
	case []interface{}:
		newValue, needReplace := enrichNestedObject(typed)
		if needReplace {
			res = newValue
		}
	default:
		sValue := viper.GetString(key)
		if templateVariablePattern.MatchString(sValue) {
			res = templateVariablePattern.ReplaceAllStringFunc(sValue, regexReplace)
		}
	}
	if res != nil {
		//set value
		valuePath := jsonutils.NewJSONPath(strings.ReplaceAll(key, ".", "/"))
		err := valuePath.Set(result, res)
		if err != nil {
			logging.Fatalf("Unable to set value in %s config path", key)
		}
	}
}

func enrichNestedObject(value interface{}) (interface{}, bool) {
	valueChanged := false
	switch typed := value.(type) {
	case []interface{}:
		arr := make([]interface{}, len(typed))
		for i, v := range typed {
			changed := false
			arr[i], changed = enrichNestedObject(v)
			if changed {
				valueChanged = true
			}
		}
		return arr, valueChanged
	case map[interface{}]interface{}:
		mp := make(map[interface{}]interface{}, len(typed))
		for i, v := range typed {
			changed := false
			mp[i], changed = enrichNestedObject(v)
			if changed {
				valueChanged = true
			}
		}
		return mp, valueChanged
	case string:
		if templateVariablePattern.MatchString(typed) {
			return templateVariablePattern.ReplaceAllStringFunc(typed, regexReplace), true
		} else {
			return value, false
		}
	default:
		return value, false
	}
}

//handleConfigErr returns err only if application can't start without config
//otherwise log error and return nil
func handleConfigErr(err error, containerizedRun bool, configNotFoundErrMsg string) error {
	//failfast for running service from source (not containerised) and with wrong config
	if !containerizedRun {
		return err
	}

	logging.ConfigErr = err.Error()
	logging.ConfigWarn = configNotFoundErrMsg
	return nil
}
