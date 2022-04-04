package ipc

import (
	"context"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

type Retry struct {
	error
}

func (e Retry) Unwrap() error {
	return e.error
}

type Governor struct {
	process Process
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
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
			data, err := g.exchange(data)
			if err == nil {
				return data, nil
			}

			if errors.As(err, &Retry{}) {
				continue
			}

			logging.Warnf("%s exchange error: %v", g.process, err)

			g.process.Kill()
			if err := g.process.Wait(); err != nil {
				logging.Warnf("%s wait error: %v", g.process, err)
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
