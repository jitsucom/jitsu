package base

import (
	"os/exec"
)

//SyncCommand is a dto for keeping sync command for graceful closing
type SyncCommand struct {
	Command    *exec.Cmd
	TaskCloser CLITaskCloser
	Docker     bool
}

//Shutdown uses Kill() under the hood. Closes task
func (sc *SyncCommand) Shutdown() error {
	sc.TaskCloser.CloseWithError("Command has been killed..", false)
	return sc.kill()
}

//Kill uses docker stop command for closing docker sync tasks (airbyte)
func (sc *SyncCommand) Kill(msg string) error {
	sc.TaskCloser.CloseWithError(msg, false)
	return sc.kill()
}

func (sc *SyncCommand) kill() error {
	if sc.Docker {
		exec.Command("docker", "stop", sc.TaskCloser.TaskID(), "&").Start()
	}

	return sc.Command.Process.Kill()
}
