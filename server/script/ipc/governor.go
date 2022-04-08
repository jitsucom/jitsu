package ipc

import (
	"context"
	"fmt"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

type Interface interface {
	Send(data []byte) error
	Receive() ([]byte, error)
}

type Process interface {
	Interface
	fmt.Stringer
	Spawn() (Process, error)
	Kill()
	Wait() error
}

const governorErrorThreshold = 3

type Governor struct {
	process Process
	errcnt  int
	err     error
	mu      Mutex
}

func Govern(process Process) (*Governor, error) {
	process, err := process.Spawn()
	if err != nil {
		return nil, errors.Wrap(err, "spawn")
	}

	logging.Debugf("%s started successfully", process)
	return &Governor{process: process}, nil
}

func (g *Governor) Exchange(ctx context.Context, data []byte) ([]byte, error) {
	cancel, err := g.mu.Lock(ctx)
	if err != nil {
		return nil, err
	}

	defer cancel()
	if g.errcnt >= governorErrorThreshold && g.err != nil {
		return nil, g.err
	}

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
			data, err := g.exchange(data)
			if err == nil {
				g.errcnt = 0
				return data, nil
			} else {
				g.errcnt++
				g.err = err
			}

			logging.Warnf("%s exchange error: %v", g.process, err)

			g.process.Kill()
			if err := g.process.Wait(); err != nil {
				logging.Warnf("%s wait error: %v", g.process, err)
			}

			if g.errcnt >= governorErrorThreshold {
				return nil, err
			}

			process, err := g.process.Spawn()
			if err != nil {
				return nil, errors.Wrap(err, "respawn")
			}

			logging.Debugf("%s respawned as %s", g.process, process)
			g.process = process
		}
	}
}

func (g *Governor) exchange(data []byte) ([]byte, error) {
	if err := g.process.Send(data); err != nil {
		return nil, err
	}

	return g.process.Receive()
}

func (g *Governor) Kill() {
	cancel, _ := g.mu.Lock(context.Background())
	defer cancel()
	g.process.Kill()
}

func (g *Governor) Wait() error {
	cancel, _ := g.mu.Lock(context.Background())
	defer cancel()
	if err := g.process.Wait(); err != nil {
		return err
	}

	logging.Debugf("%s completed successfully", g.process)
	return nil
}

func (g *Governor) String() string {
	return g.process.String()
}
