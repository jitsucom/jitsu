package node2

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/script/ipc"
	"github.com/jitsucom/jitsu/server/timestamp"
)

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

type exchanger struct {
	*ipc.Governor
}

func (e *exchanger) Exchange(command string, payload, result interface{}) error {
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
	newData, err := e.Governor.Exchange(ctx, data)

	logging.Debugf("%s: %s => %s (%v) [%s]", e, string(data), string(newData), err, timestamp.Now().Sub(start))
	if err != nil {
		return err
	}

	var resp Response
	if err := json.Unmarshal(newData, &resp); err != nil {
		return err
	}

	for _, log := range resp.Log {
		switch log.Level {
		case "debug":
			logging.Debugf("%s: %s", e, log.Message)
		case "info", "log":
			logging.Infof("%s: %s", e, log.Message)
		case "warn":
			logging.Warnf("%s: %s", e, log.Message)
		case "error":
			logging.Errorf("%s: %s", e, log.Message)
		}
	}

	if !resp.Ok {
		if resp.Stack != "" {
			return errors.New(resp.Error + "\n" + resp.Stack)
		}

		return errors.New(resp.Error)
	}

	if result != nil {
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
