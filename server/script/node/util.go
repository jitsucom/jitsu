package node

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/pkg/errors"
)

const (
	load     = "load"
	describe = "describe"
	execute  = "execute"
	kill     = "kill"
	unload   = "unload"
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

func packageJSONPath(dir string) string {
	return filepath.Join(dir, "package.json")
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

var nodeModuleMu sync.Mutex

func installNodeModule(dir string, spec string) error {
	nodeModuleMu.Lock()
	defer nodeModuleMu.Unlock()
	args := []string{"install", "--no-audit", "--prefer-online"}
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

func closeQuietly(close io.Closer) {
	if err := close.Close(); err != nil {
		logging.Warnf("failed to close %T: %v", close, err)
	}
}
