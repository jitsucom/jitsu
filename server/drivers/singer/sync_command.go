package singer

import (
	"github.com/jitsucom/jitsu/server/drivers/base"
	"os/exec"
)

//SyncCommand is a dto for keeping sync command for graceful closing
type SyncCommand struct {
	Command    *exec.Cmd
	TaskCloser base.CLITaskCloser
}

//Shutdown uses Kill() under the hood. Closes task
func (sc *SyncCommand) Shutdown() error {
	sc.TaskCloser.CloseWithError("Shutdown.. The command has been killed..", false)
	return sc.Command.Process.Kill()
}

//Kill uses docker stop command for closing docker sync tasks (airbyte)
func (sc *SyncCommand) Kill(msg string) error {
	sc.TaskCloser.CloseWithError(msg, false)
	return sc.Command.Process.Kill()
}
