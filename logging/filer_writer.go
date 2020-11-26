package logging

import (
	"fmt"
	"github.com/google/martian/log"
	"github.com/jitsucom/eventnative/safego"
	"gopkg.in/natefinch/lumberjack.v2"
	"io"
	"path/filepath"
	"regexp"
	"time"
)

const logFileMaxSizeMB = 100

//regex for reading already rotated and closed log files
var TokenIdExtractRegexp = regexp.MustCompile("-event-(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

type WriterProxy struct {
	lWriter       *lumberjack.Logger
	rotateOnClose bool
}

func NewRollingWriter(config Config) io.WriteCloser {
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
	safego.RunWithRestart(func() {
		for {
			<-ticker.C
			if err := lWriter.Rotate(); err != nil {
				log.Errorf("Error rotating log file: %v", err)
			}
		}
	})

	return &WriterProxy{lWriter: lWriter, rotateOnClose: config.RotateOnClose}
}

func (wp *WriterProxy) Write(p []byte) (int, error) {
	return wp.lWriter.Write(p)
}

func (wp *WriterProxy) Close() error {
	if wp.rotateOnClose {
		if err := wp.lWriter.Rotate(); err != nil {
			log.Errorf("Error rotating log file: %v", err)
		}
	}

	return wp.lWriter.Close()
}
