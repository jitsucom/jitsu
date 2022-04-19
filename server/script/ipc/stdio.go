package ipc

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

// StdIO allows to start to process and communicate to it via standard input/output.
// Note that it currently uses '\n' for delimiting sent messages.
type StdIO struct {
	Dir  string
	Path string
	Args []string

	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	stderr *bytes.Buffer
	cancel func()
}

func (p *StdIO) Spawn() (Process, error) {
	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, p.Path, p.Args...)
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
		Dir:    p.Dir,
		Path:   p.Path,
		Args:   p.Args,
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		stderr: stderr,
		cancel: cancel,
	}, nil
}

func (p *StdIO) Send(_ context.Context, data []byte) error {
	data = append(data, '\n')
	_, err := p.stdin.Write(data)
	return err
}

func (p *StdIO) Receive(ctx context.Context, dataChannel chan<- []byte) ([]byte, error) {
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
		line, _, err := reader.ReadLine()
		if (len(line) > 30 && line[0] == 'J' && line[1] == ':' &&
			strings.Contains(string(line), "_JITSU_SCRIPT_RESULT")) ||
			err == io.EOF {
			done <- true
			return line[2:], err
		} else if len(line) > 0 {
			if dataChannel != nil {
				dataChannel <- line
			} else {
				logging.Info(string(line))
			}
		}
	}
}

func (p *StdIO) Kill() {
	p.cancel()
}

func (p *StdIO) Wait() error {
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
		return nil
	}

	_ = p.stdin.Close()
	_ = p.stdout.Close()

	stderr := p.stderr.String()
	if err != nil {
		if stderr != "" {
			logging.Debugf("%s stderr below:\n%s", p, stderr)
		}

		return &CommandError{
			ExitError: err,
			Stderr:    p.stderr.String(),
		}
	} else if stderr != "" {
		logging.Warnf("%s completed ok, but has stderr below:\n%s", p, stderr)
	}

	return nil
}

func (p *StdIO) String() string {
	return fmt.Sprintf("%s %s (%d)", p.Path, strings.Join(p.Args, " "), p.cmd.Process.Pid)
}

type CommandError struct {
	ExitError error
	Stderr    string
}

func (e *CommandError) Error() string {
	return e.ExitError.Error()
}

func (e *CommandError) Unwrap() error {
	return e.ExitError
}
