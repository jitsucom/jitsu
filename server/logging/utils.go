package logging

import (
	"io/ioutil"
	"os"
	"path"
)

func IsDirWritable(dir string) bool {
	testFile := path.Join(dir, "tmp_test")
	err := ioutil.WriteFile(testFile, []byte{}, 0644)
	if err != nil {
		return false
	}

	os.Remove(testFile)
	return true
}

func EnsureDir(dir string) error {
	return os.MkdirAll(dir, 0766)
}
