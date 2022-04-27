package node

import (
	_ "embed"
	"fmt"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/pkg/errors"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var maxScriptErrors = 3

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
	*Init
	exchanger  *exchanger
	colOffset  int
	rowOffset  int
	errCount   int
	standalone bool
}

func (s *Script) Describe() (script.Symbols, error) {
	value := make(script.Symbols)
	if err := s.exchange(describe, s.Session, &value, nil, 0); err != nil {
		return nil, err
	}

	return value, nil
}

func (s *Script) Execute(name string, args []interface{}, result interface{}) error {
	if args == nil {
		args = make([]interface{}, 0)
	}

	return s.exchange(execute, Execute{Session: s.Session, Function: name, Args: args}, result, nil, 0)
}

func (s *Script) ExecuteWithDataChannel(name string, args []interface{}, result interface{}, dataChannel chan<- interface{}) error {
	if args == nil {
		args = make([]interface{}, 0)
	}

	return s.exchange(execute, Execute{Session: s.Session, Function: name, Args: args}, result, dataChannel, time.Hour)
}

func (s *Script) Close() {
	if s.exchanger != nil {
		_ = s.exchanger.exchangeDirect(unload, s.Session, nil, nil)
		if s.standalone {
			s.exchanger.Kill()
			s.exchanger = nil
		}
	}
}

var vmStackTraceLine = regexp.MustCompile(`^\s*at\s(.*?)\s\(vm\.js:(\d+):(\d+)\)$`)

func (s *Script) exchange(command string, payload, result interface{}, dataChannel chan<- interface{}, timeout time.Duration) error {
	err := s.exchanger.exchange(command, payload, result, dataChannel, timeout)
	if errors.Is(err, ipc.ErrOutOfMemory) {
		s.errCount++
		if s.errCount >= maxScriptErrors {
			return err
		}

		return s.exchange(command, payload, result, dataChannel, timeout)
	}

	switch {
	case err == nil:
		s.errCount = 0
		return nil
	case errors.Is(err, errLoadRequired):
		if err := s.exchanger.exchange(load, s.Init, nil, nil, 0); err != nil {
			return errors.Wrapf(err, "load script %s", s.Session)
		}

		return s.exchange(command, payload, result, dataChannel, timeout)
	default:
		s.errCount = 0
		if jsError, ok := err.(jsError); ok {
			return s.rewriteJavaScriptStack(jsError)
		}

		return err
	}
}

func (s *Script) rewriteJavaScriptStack(err jsError) jsError {
	if err.stack == "" {
		return err
	}

	lines := strings.Split(err.stack, "\n")
	stack := make([]string, 0)
	for i, line := range lines {
		if i == 0 {
			continue
		}

		match := vmStackTraceLine.FindStringSubmatch(line)
		if len(match) == 0 {
			continue
		}

		function := match[1]
		if function == "module.exports" {
			function = "main"
		}

		row, _ := strconv.Atoi(match[2])
		row -= s.rowOffset + 1 + len(s.Init.Includes)
		if row < 0 {
			return err
		}

		column, _ := strconv.Atoi(match[3])
		if row == 1 {
			column -= s.colOffset
		}

		stack = append(stack, fmt.Sprintf(`  at %s (%d:%d)`, function, row, column))
	}

	if len(stack) == 0 {
		return err
	}

	err.stack = err.message + "\n" + strings.Join(stack, "\n")
	return err
}
