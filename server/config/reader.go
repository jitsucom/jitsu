package config

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/spf13/viper"
	"os"
	"strings"
)

//Read reads config from configSourceStr that might be (HTTP URL or path to YAML/JSON file or plain JSON string)
//replaces all ${env.VAR} placeholders with OS variables
//configSourceStr might be overridden by "config_location" ENV variable
//returns err if occurred
func Read(configSourceStr string, containerizedRun bool, configNotFoundErrMsg string) error {
	viper.AutomaticEnv()

	//support OS env variables as lower case and dot divided variables e.g. SERVER_PORT as server.port
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	//overridden configuration from ENV
	overriddenConfigLocation := viper.GetString("config_location")
	if overriddenConfigLocation != "" {
		configSourceStr = overriddenConfigLocation
	}

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
		value := viper.GetString(k)
		if strings.Contains(value, "${env.") {
			parts := strings.Split(value, "${env.")
			if len(parts) != 2 {
				logging.Fatalf("Malformed ${env.VAR} placeholder in config value: %s = %s", k, value)
			}

			values := strings.Split(parts[1], "}")
			if len(values) != 2 {
				logging.Fatalf("Malformed ${env.VAR} placeholder in config value: %s = %s", k, value)
			}

			var envName, defaultValue string
			envExpression := values[0]
			envName = envExpression
			//check if default value
			if strings.Contains(envName, "|") {
				envNameParts := strings.Split(envName, "|")
				if len(envNameParts) != 2 {
					logging.Fatalf("Malformed ${env.VAR|default_value} placeholder in config value: %s = %s", k, value)
				}
				envName = envNameParts[0]
				defaultValue = envNameParts[1]
			}
			res := os.Getenv(envName)
			if len(res) == 0 {
				if defaultValue == "" {
					logging.Fatalf("Mandatory env variable was not found: %s", envName)
				}

				res = defaultValue
			}

			valuePath := jsonutils.NewJSONPath(strings.ReplaceAll(k, ".", "/"))
			err := valuePath.Set(envPlaceholderValues, strings.ReplaceAll(value, "${env."+envExpression+"}", res))
			if err != nil {
				logging.Fatalf("Unable to set value in %s config path", k)
			}
		}
	}

	//merge back into viper
	if len(envPlaceholderValues) > 0 {
		if err := viper.MergeConfigMap(envPlaceholderValues); err != nil {
			logging.Fatalf("Error merging env values into viper config: %v", err)
		}
	}

	return nil
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
