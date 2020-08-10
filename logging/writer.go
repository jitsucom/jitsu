package logging

import (
	"fmt"
	"gopkg.in/natefinch/lumberjack.v2"
	"io"
	"os"
	"path/filepath"
	"time"
)

const logFileMaxSizeMB = 100

//Create stdout or file or mock writers
func NewWriter(config Config) (io.WriteCloser, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("Error while creating %v logger: %v", config.LoggerName, err)
	}
	if config.FileDir != "" {
		return newRollingWriter(config)
	} else {
		return os.Stdout, nil
	}
}

func newRollingWriter(config Config) (io.WriteCloser, error) {
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
			lWriter.Rotate()
		}
	}()

	return lWriter, nil
}
