package node

import (
	"context"
	_ "embed"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"text/template"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

const executableScriptName = "main.cjs"

type scriptTemplateValues struct {
	Executable string
	Variables  string
	Includes   string
}

var (
	//go:embed script.js
	scriptTemplateContent string
	scriptTemplate, _     = template.New("node_script").Parse(scriptTemplateContent)
)

type factory struct {
	packages map[string]string
}

func Factory() script.Factory {
	return &factory{
		packages: map[string]string{"node-fetch": "2"},
	}
}

func (f *factory) CreateScript(executable script.Executable, variables map[string]interface{}, includes ...string) (script.Interface, error) {
	dir := filepath.Join(os.TempDir(), "jitsu-nodejs-"+uuid.NewV4().String())
	if err := os.RemoveAll(dir); err != nil {
		return nil, errors.Wrapf(err, "purge temp dir '%s'", dir)
	}

	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, errors.Wrapf(err, "create temp dir '%s'", dir)
	}

	if err := f.createPackageJSON(dir); err != nil {
		return nil, errors.Wrapf(err, "create package.json in '%s'", dir)
	}

	if err := f.installNodeModules(dir, executable.Dependencies()); err != nil {
		return nil, errors.Wrapf(err, "install node modules in '%s'", dir)
	}

	dependencies, err := f.readPackageJSONDependencies(dir)
	if err != nil {
		return nil, errors.Wrapf(err, "read package.json dependencies from '%s'", dir)
	}

	expression, err := executable.Expression(dependencies)
	if err != nil {
		return nil, errors.Wrap(err, "compose javascript expression")
	}

	scriptPath := filepath.Join(dir, executableScriptName)
	scriptFile, err := os.Create(scriptPath)
	if err != nil {
		return nil, errors.Wrapf(err, "create main script in '%s'", dir)
	}

	err = scriptTemplate.Execute(scriptFile, scriptTemplateValues{
		Executable: f.escape(expression),
		Includes:   f.escape(strings.Join(append([]string{`globalThis.fetch = require("node-fetch")`}, includes...), "\n\n")),
		Variables:  f.escape(variables),
	})

	closeQuietly(scriptFile)
	if err != nil {
		return nil, errors.Wrapf(err, "execute script template to '%s'", scriptPath)
	}

	process := &ipc.StdIO{
		Dir:  dir,
		Path: "node",
		Args: []string{executableScriptName},
	}

	governor, err := ipc.Govern(process)
	if err != nil {
		return nil, errors.Wrapf(err, "govern process")
	}

	logging.Debugf("%s running as %s/%s", governor, dir, executableScriptName)
	return &Script{
		governor: governor,
		dir:      dir,
	}, nil
}

func (f *factory) escape(value interface{}) string {
	data, _ := json.Marshal(value)
	return strings.Trim(string(data), `"`)
}

func (f *factory) installNodeModules(dir string, modules []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	args := []string{"install"}
	for name, version := range f.packages {
		args = append(args, name+"@"+version)
	}

	args = append(args, modules...)
	cmd := exec.CommandContext(ctx, "npm", args...)
	cmd.Dir = dir
	return cmd.Run()
}

func (f *factory) getVariables(vars map[string]interface{}) (json.RawMessage, error) {
	variables := make(map[string]interface{})
	for key, value := range vars {
		if reflect.TypeOf(value).Kind() != reflect.Func {
			variables[key] = value
		}
	}

	return json.Marshal(variables)
}

func (f *factory) readPackageJSONDependencies(dir string) ([]string, error) {
	file, err := os.Open(f.packageJSONPath(dir))
	if err != nil {
		return nil, errors.Wrap(err, "open package.json")
	}

	defer closeQuietly(file)
	var packageJSON struct {
		Dependencies map[string]interface{} `json:"dependencies"`
	}

	if err := json.NewDecoder(file).Decode(&packageJSON); err != nil {
		return nil, errors.Wrap(err, "decode package.json")
	}

	dependencies := make([]string, 0)
	for dependency := range packageJSON.Dependencies {
		if _, ok := f.packages[dependency]; !ok {
			dependencies = append(dependencies, dependency)
		}
	}

	return dependencies, nil
}

func (f *factory) createPackageJSON(dir string) error {
	file, err := os.Create(f.packageJSONPath(dir))
	if err != nil {
		return errors.Wrapf(err, "create package.json in '%s'", dir)
	}

	defer closeQuietly(file)
	if _, err := file.Write([]byte("{}")); err != nil {
		return errors.Wrapf(err, "write to package.json in '%s'", dir)
	}

	return nil
}

func (f *factory) packageJSONPath(dir string) string {
	return filepath.Join(dir, "package.json")
}
