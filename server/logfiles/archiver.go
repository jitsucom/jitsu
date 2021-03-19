package logfiles

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"regexp"
)

var dateExtractor = regexp.MustCompile(".*-(\\d\\d\\d\\d-\\d\\d-\\d\\d)T")

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

	outputDir := a.archiveDir
	regexResult := dateExtractor.FindStringSubmatch(sourceFilePath)
	if len(regexResult) != 2 {
		logging.Warnf("Archiver: can't get date from file name: %s", sourceFilePath)
	} else {
		outputDir = path.Join(a.archiveDir, regexResult[1])
		_ = os.Mkdir(outputDir, 0744)
	}

	err = ioutil.WriteFile(path.Join(outputDir, filepath.Base(sourceFilePath)+".gz"), output.Bytes(), 0644)
	if err != nil {
		return err
	}

	err = os.Remove(sourceFilePath)
	if err != nil {
		return fmt.Errorf("Error removing source file [%s] after archiving: %v", sourceFilePath, err)
	}

	return nil
}
