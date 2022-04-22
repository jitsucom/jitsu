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
	Version      string            `json:"version"`
}

func readPackageJSON(dir string) (*packageJSON, error) {
	file, err := os.Open(filepath.Join(dir, "package.json"))
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

var nodeModuleMu sync.Mutex

func installNodeModule(dir string, spec string) error {
	nodeModuleMu.Lock()
	defer nodeModuleMu.Unlock()
	args := []string{"install", "--no-audit", "--prefer-offline"}
	args = append(args, spec)
	return script.Exec(dir, npm, args...)
}

func checkNodeModule(modulesDir string, name, version string) error {
	packageJSON, err := readPackageJSON(filepath.Join(modulesDir, name))
	if err != nil {
		return errors.Wrapf(err, "read package.json for %s", name)
	}

	if packageJSON.Version != version {
		return errors.Errorf(
			"installed version %s does not match required (%s)",
			packageJSON.Version, version)
	}

	return nil
}

func escapeJSON(value string) string {
	data, _ := json.Marshal(value)
	return strings.Trim(string(data), `"`)
}
