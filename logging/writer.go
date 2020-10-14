package logging

import (
	"fmt"
	"github.com/google/martian/log"
	"gopkg.in/natefinch/lumberjack.v2"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

const logFileMaxSizeMB = 100

//regex for reading already rotated and closed log files
var TokenIdExtractRegexp = regexp.MustCompile("-event-(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

type WriterProxy struct {
	lWriter *lumberjack.Logger
}

//Create stdout or file or mock writers
func NewWriter(config Config) (io.WriteCloser, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("Error while creating %v logger: %v", config.LoggerName, err)
	}
	if config.FileDir != "" {
		return newRollingWriter(config), nil
	} else {
		return os.Stdout, nil
	}
}

func newRollingWriter(config Config) io.WriteCloser {
	fileNamePath := filepath.Join(config.FileDir, fmt.Sprintf("%s-%s.log", config.ServerName, config.LoggerName))
	lWriter := &lumberjack.Logger{
		Filename: fileNamePath,
		MaxSize:  logFileMaxSizeMB,
	}
	if config.MaxBackups > 0 {
		lWriter.MaxBackups = config.MaxBackups
	}

	if config.RotationMin == 0 {
		config.RotationMin = 1440 //24 hours
	}
	rotation := time.Duration(config.RotationMin) * time.Minute
	ticker := time.NewTicker(rotation)
	go func() {
		for {
			<-ticker.C
			if err := lWriter.Rotate(); err != nil {
				log.Errorf("Error rotating log file: %v", err)
			}
		}
	}()

	return &WriterProxy{lWriter: lWriter}
}

func (wp *WriterProxy) Write(p []byte) (int, error) {
	return wp.lWriter.Write(p)
}

func (wp *WriterProxy) Close() error {
	if err := wp.lWriter.Rotate(); err != nil {
		log.Errorf("Error rotating log file: %v", err)
	}

	return wp.lWriter.Close()
}
