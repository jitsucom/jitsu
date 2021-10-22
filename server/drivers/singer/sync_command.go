package singer

import (
	"os/exec"
)

type CommandCloser struct {
	command *exec.Cmd
}

func (cc *CommandCloser) Close() error {
	return cc.command.Process.Kill()
}

func (cc *CommandCloser) String() string {
	return cc.command.String()
}
