package logging

import (
	"errors"
	"fmt"
	"log"
)

type Config struct {
	LoggerName  string
	LoggerType  string
	ServerName  string
	FileDir     string
	RotationMin int64
	MaxBackups  int
}

func (c Config) Validate() error {
	if c.LoggerName == "" {
		return errors.New("Logger name can't be empty")
	}
	if c.ServerName == "" {
		return errors.New("Server name can't be empty")
	}
	if c.LoggerType == "" {
		return errors.New("Logger type can't be empty")
	}
	if c.LoggerType == "file" {
		if c.FileDir == "" {
			return errors.New("File dir can't be empty")
		}
		if c.RotationMin == 0 {
			return errors.New("Rotation min can't be 0")
		}
	}

	return nil
}

func InitGlobalLogger(config Config) error {
	if err := config.Validate(); err != nil {
		return fmt.Errorf("Error while creating global logger: %v", err)
	}
	writer, err := NewWriter(config)
	if err != nil {
		return err
	}
	log.SetOutput(writer)
	log.SetFlags(log.Ldate | log.Ltime | log.LUTC)

	return nil
}
