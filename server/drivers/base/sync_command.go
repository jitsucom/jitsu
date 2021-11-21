package base

import (
	"github.com/jitsucom/jitsu/server/runner"
)

type ExecCommand interface {
	String() string
	Close() error
}

//SyncCommand is a dto for keeping sync command (airbyte/singer) for graceful closing
type SyncCommand struct {
	Cmd        ExecCommand
	TaskCloser CLITaskCloser
}

//Cancel uses Kill() under the hood
func (sc *SyncCommand) Cancel() error {
	return sc.Kill("Synchronization has been canceled. The command is going to be killed..")
}

//Shutdown uses Kill() under the hood
func (sc *SyncCommand) Shutdown() error {
	return sc.Kill("Shutdown.. The command is going to be killed..")
}

//Kill closes runner and uses taskCloser with err msg
func (sc *SyncCommand) Kill(msg string) error {
	sc.TaskCloser.CloseWithError(msg, false)
	if err := sc.Cmd.Close(); err != nil && err != runner.ErrAirbyteAlreadyTerminated {
		return err
	}

	return nil
}
