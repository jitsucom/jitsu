package node

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/jitsucom/jitsu/server/script"
	"github.com/pkg/errors"
)

func sanitizeVariables(vars map[string]interface{}) map[string]interface{} {
	variables := make(map[string]interface{})
	for key, value := range vars {
		if reflect.TypeOf(value).Kind() != reflect.Func {
			variables[key] = value
		}
	}

	return variables
}

type packageJSON struct {
	Main         string            `json:"main"`
	Dependencies map[string]string `json:"dependencies"`
}

func readPackageJSON(dir string) (*packageJSON, error) {
	file, err := os.Open(packageJSONPath(dir))
	if err != nil {
		return nil, errors.Wrap(err, "open package.json")
	}

	defer closeQuietly(file)
	var data packageJSON
	if err := json.NewDecoder(file).Decode(&data); err != nil {
		return nil, errors.Wrap(err, "decode package.json")
	}

	return &data, nil
}

func createPackageJSON(dir string, value packageJSON) error {
	file, err := os.Create(packageJSONPath(dir))
	if err != nil {
		return errors.Wrapf(err, "create package.json in '%s'", dir)
	}

	defer closeQuietly(file)
	if err := json.NewEncoder(file).Encode(value); err != nil {
		return errors.Wrapf(err, "write to package.json in '%s'", dir)
	}

	return nil
}

func packageJSONPath(dir string) string {
	return filepath.Join(dir, "package.json")
}

var nodeModuleMu sync.Mutex

func installNodeModule(dir string, spec string) error {
	nodeModuleMu.Lock()
	defer nodeModuleMu.Unlock()
	args := []string{"install", "--no-audit", "--prefer-offline"}
	args = append(args, spec)
	return errors.Wrapf(script.Exec(dir, npm, args...), "failed to install npm package %s", spec)
}

func escapeJSON(value string) string {
	data, _ := json.Marshal(value)
	return strings.Trim(string(data), `"`)
}
