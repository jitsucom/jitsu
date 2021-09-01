package runner

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"os/exec"
	"strings"
	"sync"
)

//ExecCmd executes command with args and uses stdOutWriter and stdErrWriter to pipe the result
func ExecCmd(system, cmd string, stdOutWriter, stdErrWriter io.Writer, args ...string) error {
	logging.Debugf("Running %s command: %s with args [%s]", system, cmd, strings.Join(args, ", "))
	execCmd := exec.Command(cmd, args...)

	stdout, _ := execCmd.StdoutPipe()
	stderr, _ := execCmd.StderrPipe()

	err := execCmd.Start()
	if err != nil {
		return err
	}

	var wg sync.WaitGroup

	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(stdOutWriter, stdout)
	})

	wg.Add(1)
	safego.Run(func() {
		defer wg.Done()
		io.Copy(stdErrWriter, stderr)
	})

	wg.Wait()

	err = execCmd.Wait()
	if err != nil {
		return err
	}

	return nil
}
