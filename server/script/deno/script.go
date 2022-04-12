package deno

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	ipc "github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/jitsucom/jitsu/server/timestamp"
)

type Request struct {
	Command string      `json:"command"`
	Payload interface{} `json:"payload,omitempty"`
}

type Execute struct {
	Function string        `json:"function,omitempty"`
	Args     []interface{} `json:"args"`
}

type Log struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type Response struct {
	Ok     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Log    []Log           `json:"log,omitempty"`
}

const (
	describe = "describe"
	execute  = "execute"
	kill     = "kill"
)

type Script struct {
	governor *ipc.Governor
	dir      string
}

func (s *Script) Describe() (script.Symbols, error) {
	value := make(script.Symbols)
	if err := s.exchange(describe, nil, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func (s *Script) Execute(name string, args []interface{}, result interface{}) error {
	if args == nil {
		args = make([]interface{}, 0)
	}

	return s.exchange(execute, Execute{Function: name, Args: args}, result)
}

func (s *Script) Close() {
	if err := s.exchange(kill, nil, nil); err != nil {
		logging.Warnf("send kill signal failed, killing: %v", err)
		s.governor.Kill()
	}

	if err := s.governor.Wait(); err != nil {
		logging.Warnf("wait process failed: %v", err)
	}

	//_ = os.RemoveAll(s.dir)
}

func (s *Script) exchange(command string, payload, result interface{}) error {
	data, err := json.Marshal(Request{
		Command: command,
		Payload: payload,
	})

	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	start := timestamp.Now()
	newData, err := s.governor.Exchange(ctx, data)

	logging.Debugf("%s: %s => %s (%v) [%s]", s.governor, string(data), string(newData), err, timestamp.Now().Sub(start))
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(newData, &resp); err != nil {
		return err
	}

	if !resp.Ok {
		return errors.New(resp.Error)
	}

	if result != nil {
		return json.Unmarshal(resp.Result, result)
	}

	return nil
}

func closeQuietly(close io.Closer) {
	if err := close.Close(); err != nil {
		logging.Warnf("failed to close %T: %v", close, err)
	}
}
