package script

import "github.com/pkg/errors"

var DummyFactory = dummyFactory{}

type dummyFactory struct{}

func (dummyFactory) CreateScript(executable Executable, variables map[string]interface{}, includes ...string) (Interface, error) {
	return nil, errors.New("JavaScript functions are disabled")
}
