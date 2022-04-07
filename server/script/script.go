package script

import (
	"encoding/json"
	"strings"

	"github.com/pkg/errors"
)

type Descriptor struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

type BuildInfo struct {
	SdkVersion     string `json:"sdkVersion"`
	SdkPackage     string `json:"sdkPackage"`
	BuildTimestamp string `json:"buildTimestamp"`
}

type Exports struct {
	Descriptor Descriptor `json:"descriptor"`
	BuildInfo  BuildInfo  `json:"buildInfo"`
}

type Symbol struct {
	Type  string          `json:"type"`
	Value json.RawMessage `json:"value,omitempty"`
}

func (s Symbol) As(value interface{}) error {
	return json.Unmarshal(s.Value, value)
}

type Symbols map[string]Symbol

type Args = []interface{}

type Interface interface {
	Describe() (Symbols, error)
	Execute(name string, args Args, result interface{}) error
	Close()
}

type Factory interface {
	CreateScript(executable Executable, variables map[string]interface{}, includes ...string) (Interface, error)
}

type Executable interface {
	Dependencies() []string
	Expression(dependencies []string) (string, error)
}

type Expression string

func (e Expression) Dependencies() []string {
	return nil
}

func (e Expression) Expression(dependencies []string) (string, error) {
	expression := string(e)
	if !strings.Contains(expression, "return") {
		expression = "return " + expression
	}

	return `async (event) => {
  let $ = event;
  let _ = event;
// expression start //
` + expression + `
// expression end //
}`, nil
}

type Package string

func (p Package) Dependencies() []string {
	return []string{string(p)}
}

func (p Package) Expression(dependencies []string) (string, error) {
	if len(dependencies) == 0 {
		return "", errors.Errorf("no dependencies found (searching for %s)", string(p))
	}

	return `require("` + dependencies[0] + `")`, nil
}
