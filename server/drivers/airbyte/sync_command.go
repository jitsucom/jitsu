package airbyte

import (
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/drivers/base"
)

//SyncCommand is a dto for keeping sync command for graceful closing
type SyncCommand struct {
	Runner     *airbyte.Runner
	TaskCloser base.CLITaskCloser
}

//Shutdown uses Kill() under the hood. Closes task
func (sc *SyncCommand) Shutdown() error {
	return sc.Kill("Shutdown.. The command has been killed..")
}

//Kill uses docker stop command for closing docker sync tasks (airbyte)
func (sc *SyncCommand) Kill(msg string) error {
	sc.TaskCloser.CloseWithError(msg, false)
	if err := sc.Runner.Close(); err != nil && err != airbyte.ErrAlreadyTerminated {
		return err
	}

	return nil
}
