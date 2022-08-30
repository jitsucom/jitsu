package ipc

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

const (
	JitsuScriptResultCommand = "_JITSU_RESULT"
)

// DataListener is used to listen for multiline execution output.
type DataListener interface {

	// Data is called for each line of output.
	Data(data []byte)
}

// StdIO allows to start to process and communicate to it via standard input/output.
// Note that it currently uses '\n' for delimiting sent messages.
type StdIO struct {
	Dir  string
	Path string
	Args []string
	Env  []string

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr *bytes.Buffer
	cancel func()

	CommandProcessor func(commandName string, payload []byte) (*CommandResponse, error)
}

type CommandResponse struct {
	Command string      `json:"command"`
	Payload interface{} `json:"payload"`
}

func (p *StdIO) Spawn() (Process, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, p.Path, p.Args...)
	cmd.Env = p.Env
	if p.Dir != "" {
		cmd.Dir = p.Dir
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, errors.Wrap(err, "create stdin pipe")
	}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		_ = stdin.Close()
		cancel()
		return nil, errors.Wrap(err, "create stdout pipe")
	}

	stderr := new(bytes.Buffer)
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		_ = stdin.Close()
		_ = stdout.Close()
		cancel()
		return nil, errors.Wrap(err, "start process")
	}

	return &StdIO{
		Dir:              p.Dir,
		Path:             p.Path,
		Args:             p.Args,
		cmd:              cmd,
		stdin:            stdin,
		stdout:           stdout,
		stderr:           stderr,
		cancel:           cancel,
		CommandProcessor: p.CommandProcessor,
	}, nil
}

func (p *StdIO) Send(_ context.Context, data []byte) error {
	data = append(data, '\n')
	_, err := p.stdin.Write(data)
	return err
}

func (p *StdIO) Receive(ctx context.Context, listener DataListener) ([]byte, error) {
	done := make(chan bool)
	defer close(done)
	go func() {
		select {
		case <-ctx.Done():
			p.cancel()
			<-done
		case <-done:
		}
	}()

	reader := bufio.NewReader(p.stdout)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			done <- true
			return line, err
		} else if line[0] == 'J' && line[1] == '$' {
			iof := bytes.IndexRune(line, ':')
			if iof > 0 {
				command := string(line[2:iof])
				payload := line[iof+1:]
				switch command {
				case JitsuScriptResultCommand:
					done <- true
					return payload, nil
				default:
					//additional commands
					commandResponse, err := p.CommandProcessor(command, payload)
					if err != nil {
						logging.Errorf("Custom command [%s] error: %s", command, err)
					}
					if commandResponse != nil {
						resp, err := json.Marshal(commandResponse)
						if err != nil {
							logging.SystemErrorf("Failed to marshal kv command response: %+v: %v", commandResponse, err)
						} else {
							p.Send(ctx, resp)
						}
						continue
					}
				}
			}
		}
		if len(line) > 1 {
			if listener != nil {
				listener.Data(line)
			} else {
				logging.Info(string(line))
			}
		}
	}
}

func (p *StdIO) Kill() {
	p.cancel()
}

func (p *StdIO) Wait() (string, error) {
	done := make(chan bool, 1)
	go func() {
		select {
		case <-done:
		case <-time.After(time.Minute):
			logging.Warnf("%s wait timeout, killing", p)
		}

		p.cancel()
	}()

	err := p.cmd.Wait()
	done <- true
	if err != nil && strings.Contains(err.Error(), "exec: Wait was already called") {
		return "", nil
	}

	_ = p.stdin.Close()
	_ = p.stdout.Close()

	stderr := p.stderr.String()
	if err != nil {
		if err, ok := err.(*exec.ExitError); ok {
			if err.ExitCode() == 133 || err.ExitCode() == -1 && strings.Contains(stderr, "out of memory") {
				return "", ErrOutOfMemory
			}
		}

		if stderr != "" {
			logging.Warnf("%s stderr:\n%s", p, stderr)
		}

		return stderr, nil
	} else if stderr != "" {
		logging.Errorf("%s completed ok, but has stderr below:\n%s", p, stderr)
	}

	return "", nil
}

func (p *StdIO) String() string {
	return fmt.Sprintf("%s %s (%d)", p.Path, strings.Join(p.Args, " "), p.cmd.Process.Pid)
}
