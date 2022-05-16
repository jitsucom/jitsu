package ipc

import (
	"context"
	"fmt"
	"go.uber.org/atomic"
	"io"
	"strings"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

var ErrOutOfMemory = errors.New("out of memory")

// Interface describes generic IPC interface.
type Interface interface {

	// Send sends a message to the process.
	Send(ctx context.Context, data []byte) error

	// Receive receives a message from the process.
	// It is advisable to support context.Context.Done() in method implementations
	// so as not to infinitely block.
	Receive(ctx context.Context, dataChannel chan<- interface{}) ([]byte, error)
}

// Process describes a process with no acquired state (except for the initial state acquired on start)
// which can be restarted (respawned) with no data or other loss. Process instance should not be started manually –
// instead, it should contain all that is necessary to start the process and be supplied to Govern function.
type Process interface {
	Interface

	// String should return a human-readable process description.
	String() string

	// Spawn spawns a new process copy and returns it.
	Spawn() (Process, error)

	// Kill kills the current running process.
	Kill()

	// Wait waits for the current process to exit.
	Wait() error
}

// Governor is responsible for keeping the Process alive.
// It will restart the process if it dies.
type Governor struct {
	process Process
	mu      Mutex
	closed  *atomic.Bool
}

// Govern starts the process and passes it to Governor instance.
func Govern(process Process) (*Governor, error) {
	process, err := process.Spawn()
	if err != nil {
		return nil, errors.Wrap(err, "spawn")
	}

	logging.Debugf("%s started successfully", process)
	return &Governor{process: process, closed: atomic.NewBool(false)}, nil
}

// Exchange sends request data and returns response data.
func (g *Governor) Exchange(ctx context.Context, data []byte, dataChannel chan<- interface{}) ([]byte, error) {
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
		}
		if g.closed.Load() {
			return nil, fmt.Errorf("governor was closed.")
		}

		data, err := g.exchange(ctx, data, dataChannel)
		if err == nil {
			return data, nil
		}
		if g.closed.Load() {
			return nil, fmt.Errorf("governor was closed.")
		}
		logging.Warnf("%s exchange error: %v", g.process, err)

		if errors.Is(err, io.EOF) ||
			strings.Contains(err.Error(), "file already closed") ||
			strings.Contains(err.Error(), "broken pipe") {

			if err := g.process.Wait(); err != nil {
				return nil, err
			}

			process, err := g.process.Spawn()
			if err != nil {
				return nil, errors.Wrap(err, "respawn")
			}

			logging.Debugf("%s respawned as %s", g.process, process)
			g.process = process
			continue
		}

		return nil, err
	}
}

func (g *Governor) exchange(ctx context.Context, data []byte, dataChannel chan<- interface{}) ([]byte, error) {
	if err := g.process.Send(ctx, data); err != nil {
		return nil, err
	}

	return g.process.Receive(ctx, dataChannel)
}

func (g *Governor) ExchangeDirect(ctx context.Context, data []byte, dataChannel chan<- interface{}) ([]byte, error) {
	cancel, err := g.mu.Lock(ctx)
	if err != nil {
		return nil, err
	}

	defer cancel()
	return g.exchange(ctx, data, dataChannel)
}

func (g *Governor) Close() error {
	cancel, _ := g.mu.Lock(context.Background())
	defer cancel()
	g.closed.Store(true)
	g.process.Kill()
	if err := g.process.Wait(); err != nil {
		return err
	}
	logging.Debugf("%s completed successfully", g.process)
	return nil
}

// kill kills the running process.
func (g *Governor) kill() {
	cancel, _ := g.mu.Lock(context.Background())
	defer cancel()
	g.process.Kill()
}

// wait waits for the running process to exit.
func (g *Governor) wait() error {
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
