package ipc

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/pkg/errors"
	"github.com/siadat/ipc"
)

type SysV struct {
	Dir  string
	Path string
	Args []string

	cmd        *exec.Cmd
	stderr     *bytes.Buffer
	sqid, rqid uint
	cancel     func()
}

func (p *SysV) Spawn() (Process, error) {
	skey, sqid, err := newSysVQueue(p.Dir)
	if err != nil {
		return nil, errors.Wrap(err, "init sysv send queue")
	}

	rkey, rqid, err := newSysVQueue(p.Dir)
	if err != nil {
		return nil, errors.Wrap(err, "init sysv recv queue")
	}

	args := p.Args
	args = append(args, fmt.Sprint(skey), fmt.Sprint(rkey))

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, p.Path, args...)
	cmd.Stdout = os.Stdout
	if p.Dir != "" {
		cmd.Dir = p.Dir
	}

	stderr := new(bytes.Buffer)
	cmd.Stderr = stderr

	if err := cmd.Start(); err != nil {
		cancel()
		return nil, errors.Wrap(err, "start process")
	}

	return &SysV{
		Dir:    p.Dir,
		Path:   p.Path,
		Args:   p.Args,
		cmd:    cmd,
		stderr: stderr,
		sqid:   sqid,
		rqid:   rqid,
		cancel: cancel,
	}, nil
}

func newSysVQueue(dir string) (key uint, qid uint, err error) {
	now := timestamp.Now()
	path := filepath.Join(dir, ".sysvmq."+fmt.Sprint(now.UnixNano()))
	if _, err = os.Stat(path); os.IsNotExist(err) {
		var mq *os.File
		if mq, err = os.Create(path); err != nil {
			err = errors.Wrapf(err, "create mq file %s", path)
			return
		} else {
			_ = mq.Close()
		}
	}

	key, err = ipc.Ftok(path, uint(now.UnixMilli()))
	if err != nil {
		err = errors.Wrap(err, "get key")
		return
	}

	qid, err = ipc.Msgget(key, ipc.IPC_CREAT|0600)
	if err != nil {
		err = errors.Wrap(err, "create")
		return
	}

	return
}

func (p *SysV) Send(data []byte) error {
	buf := &ipc.Msgbuf{
		Mtype: 1,
		Mtext: data,
	}

	if err := ipc.Msgsnd(p.sqid, buf, 0600); err != nil {
		p.cancel()
		return errors.Wrap(err, "send")
	}

	return nil
}

func (p *SysV) Receive() ([]byte, error) {
	buf := ipc.Msgbuf{
		Mtype: 0,
		Mtext: make([]byte, 0, 4096),
	}

	var err error
	for i := 0; i < 3; i++ {
		if err = ipc.Msgrcv(p.rqid, &buf, 0); err == nil {
			return buf.Mtext, nil
		}

		time.Sleep(time.Duration(i) * time.Millisecond)
	}

	if err != nil {
		return nil, errors.Wrap(err, "receive")
	}

	return buf.Mtext, nil
}

func (p *SysV) Kill() {
	p.cancel()
}

func (p *SysV) Wait() error {
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

	if err := ipc.Msgctl(p.sqid, ipc.IPC_RMID); err != nil {
		logging.Warnf("%s close send queue error: %v", p, err)
	}

	if err := ipc.Msgctl(p.rqid, ipc.IPC_RMID); err != nil {
		logging.Warnf("%s recv queue error: %v", p, err)
	}

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

func (p *SysV) String() string {
	return fmt.Sprintf("%s %s (%d)", p.Path, strings.Join(p.Args, " "), p.cmd.Process.Pid)
}
