package node

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/jitsucom/jitsu/server/timestamp"
)

var DefaultExchangeTimeout = time.Minute

type Request struct {
	Command string      `json:"command"`
	Payload interface{} `json:"payload,omitempty"`
}

type Log struct {
	Level   string `json:"level"`
	Message string `json:"message"`
}

type Response struct {
	Ok     bool            `json:"ok"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  string          `json:"error,omitempty"`
	Stack  string          `json:"stack,omitempty"`
	Log    []Log           `json:"log,omitempty"`
}

type jsError struct {
	message string
	stack   string
}

func (e jsError) Error() string {
	if e.stack != "" {
		return e.stack
	}

	return e.message
}

type exchanger struct {
	*ipc.Governor
}

var errLoadRequired = errors.New("load required")

type exchangerFunc func(ctx context.Context, data []byte, listener ipc.DataListener) ([]byte, error)

func (e *exchanger) exchangeDirect(command string, payload, result interface{}, listener script.Listener) error {
	return e.exchange0(command, payload, result, listener, e.ExchangeDirect)
}

func (e *exchanger) exchange(command string, payload, result interface{}, listener script.Listener) error {
	return e.exchange0(command, payload, result, listener, e.Exchange)
}

func (e *exchanger) exchange0(command string, payload, result interface{}, listener script.Listener, exchangerFunc exchangerFunc) error {
	data, err := json.Marshal(Request{
		Command: command,
		Payload: payload,
	})

	if err != nil {
		return fmt.Errorf("error building javascript command: %w", err)
	}

	timeout := DefaultExchangeTimeout
	if listener != nil && listener.Timeout() > 0 {
		timeout = listener.Timeout()
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	start := timestamp.Now()
	newData, err := exchangerFunc(ctx, data, listener)

	logging.Debugf("%s: %s => %s (%v) [%s]", e, string(data), string(newData), err, timestamp.Now().Sub(start))
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(newData, &resp); err != nil {
		return err
	}

	if listener != nil {
		for _, log := range resp.Log {
			listener.Log(log.Level, log.Message)
		}
	}

	if !resp.Ok {
		if resp.Error == "__load_required__" {
			return errLoadRequired
		}

		return jsError{
			message: resp.Error,
			stack:   resp.Stack,
		}
	}

	if result != nil && resp.Result != nil {
		decoder := json.NewDecoder(bytes.NewReader(resp.Result))
		//parse json exactly the same way as it happens in http request processing.
		//transform that does no changes must return exactly the same object as w/o transform
		decoder.UseNumber()
		if err := decoder.Decode(result); err != nil {
			return err
		}
	}

	return nil
}
