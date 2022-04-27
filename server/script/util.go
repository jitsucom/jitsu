package script

import (
	"bytes"
	"os/exec"

	"github.com/pkg/errors"
)

func Exec(dir string, path string, args ...string) error {
	cmd := exec.Command(path, args...)
	cmd.Dir = dir
	var buf bytes.Buffer
	cmd.Stderr = &buf
	if err := cmd.Run(); err != nil {
		if _, ok := err.(*exec.ExitError); ok {
			if buf.Len() != 0 {
				return errors.New(buf.String())
			}
		}

		return err
	}

	return nil
}
