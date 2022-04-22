package node2

import (
	_ "embed"
	"strings"

	"github.com/jitsucom/jitsu/server/script"
	"github.com/pkg/errors"
)

type Session struct {
	Session string `json:"session"`
}

type Init struct {
	Session
	Executable string                 `json:"executable"`
	Variables  map[string]interface{} `json:"variables,omitempty"`
	Includes   []string               `json:"includes,omitempty"`
}

type Execute struct {
	Session
	Function string        `json:"function,omitempty"`
	Args     []interface{} `json:"args"`
}

type Script struct {
	exchanger *exchanger
	*Init
}

func (s *Script) Describe() (script.Symbols, error) {
	value := make(script.Symbols)
	if err := s.exchange(describe, s.Session, &value); err != nil {
		return nil, err
	}

	return value, nil
}

func (s *Script) Execute(name string, args []interface{}, result interface{}) error {
	if args == nil {
		args = make([]interface{}, 0)
	}

	return s.exchange(execute, Execute{Session: s.Session, Function: name, Args: args}, result)
}

func (s *Script) Close() {
	_ = s.exchange(unload, s.Session, nil)
}

func (s *Script) exchange(command string, payload, result interface{}) error {
	err := s.exchanger.Exchange(command, payload, result)
	switch {
	case err == nil:
		return nil
	case strings.Contains(err.Error(), "init first"):
		if err := s.exchanger.Exchange(load, s.Init, nil); err != nil {
			return errors.Wrapf(err, "load script %s", s.Session)
		}

		return s.exchange(command, payload, result)
	default:
		return err
	}
}
