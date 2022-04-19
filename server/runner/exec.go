package runner

import (
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
)

var ErrAirbyteAlreadyTerminated = errors.New("Airbyte Runner has been already terminated. You can use it only once.")

//ExecCmd executes command with args and uses stdOutWriter and stdErrWriter to pipe the result
//runs separate goroutine for timeout control
func ExecCmd(system, dir, cmd string, stdOutWriter, stdErrWriter io.Writer, timeout time.Duration, args ...string) error {
	logging.Debugf("Running %s command: %s with timeout [%s] with args [%s]", system, cmd, timeout.String(), strings.Join(args, ", "))

	execCmd := exec.Command(cmd, args...)
	if dir != "" {
		execCmd.Dir = dir
	}

	stdout, _ := execCmd.StdoutPipe()
	stderr, _ := execCmd.StderrPipe()

	closed := make(chan struct{})

	//self closed
	safego.Run(func() {
		ticker := time.NewTicker(timeout)
		for {
			select {
			case <-closed:
				return
			case <-ticker.C:
				logging.Warnf("system [%s] command [%s] run [%s] timeout", system, execCmd.String(), timeout.String())
				if err := execCmd.Process.Kill(); err != nil {
					logging.SystemErrorf("Error terminating command [%s %s]: %v", cmd, strings.Join(args, ", "), err)
				}
			}
		}
	})

	defer close(closed)

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
