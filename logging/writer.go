package logging

import (
	"fmt"
	"gopkg.in/natefinch/lumberjack.v2"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
)

const logFileMaxSizeMB = 100

func NewWriter(config Config) (io.WriteCloser, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("Error while creating %v logger: %v", config.LoggerName, err)
	}
	switch config.LoggerType {
	case "file":
		return newRollingWriter(config)
	case "stdout":
		return os.Stdout, nil
	case "mock":
		return initInMemoryWriter(), nil
	default:
		return nil, fmt.Errorf("Unknown logger type %s.", config.LoggerType)
	}
}

func newRollingWriter(config Config) (io.WriteCloser, error) {
	rotation := time.Duration(config.RotationMin) * time.Minute
	fileNamePath := filepath.Join(config.FileDir, fmt.Sprintf("%s-%s.log", config.ServerName, config.LoggerName))
	log.Println("Constructing new Lumberjack rolling writer for:", fileNamePath)
	lWriter := &lumberjack.Logger{
		Filename: fileNamePath,
		MaxSize:  logFileMaxSizeMB,
	}
	if config.MaxBackups > 0 {
		lWriter.MaxBackups = config.MaxBackups
	}

	lWriter.Close()

	ticker := time.NewTicker(rotation)
	go func() {
		for {
			<-ticker.C
			lWriter.Rotate()
		}
	}()

	return lWriter, nil
}
