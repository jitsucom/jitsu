package logfiles

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
)

type Archiver struct {
	sourceDir  string
	archiveDir string
}

func NewArchiver(sourceDir, archiveDir string) *Archiver {
	_ = os.Mkdir(archiveDir, 0744)
	return &Archiver{sourceDir: sourceDir, archiveDir: archiveDir}
}

//Archive write new archived file and delete old one
func (a *Archiver) Archive(fileName string) error {
	return a.ArchiveByPath(path.Join(a.sourceDir, fileName))
}

//ArchiveByPath write new archived file and delete old one
func (a *Archiver) ArchiveByPath(sourceFilePath string) error {
	b, err := ioutil.ReadFile(sourceFilePath)
	if err != nil {
		return err
	}

	output := bytes.Buffer{}
	gzw := gzip.NewWriter(&output)

	_, err = io.Copy(gzw, bytes.NewBuffer(b))
	if err != nil {
		return err
	}

	if err := gzw.Close(); err != nil {
		return err
	}

	err = ioutil.WriteFile(path.Join(a.archiveDir, filepath.Base(sourceFilePath)+".gz"), output.Bytes(), 0644)
	if err != nil {
		return err
	}

	err = os.Remove(sourceFilePath)
	if err != nil {
		return fmt.Errorf("Error removing source file [%s] after archiving: %v", sourceFilePath, err)
	}

	return nil
}
