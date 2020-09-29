package logging

import (
	"errors"
	"fmt"
	"github.com/gookit/color"
	"log"
	"strings"
)

type Config struct {
	LoggerName  string
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

	return nil
}

//Initialize main logger
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

func Errorf(format string, v ...interface{}) {
	Error(fmt.Sprintf(format, v...))
}

func Error(v ...interface{}) {
	log.Println(errMsg(v...))
}

func Infof(format string, v ...interface{}) {
	Info(fmt.Sprintf(format, v))
}

func Info(v ...interface{}) {
	log.Println(append([]interface{}{"[INFO]:"}, v...)...)
}

func Warnf(format string, v ...interface{}) {
	Warn(fmt.Sprintf(format, v))
}

func Warn(v ...interface{}) {
	log.Println(append([]interface{}{"[WARN]:"}, v...)...)
}

func Fatal(v ...interface{}) {
	log.Fatal(errMsg(v...))
}

func errMsg(values ...interface{}) string {
	valuesStr := []string{"[ERROR]:"}
	for _, v := range values {
		valuesStr = append(valuesStr, fmt.Sprint(v))
	}
	return color.Red.Sprint(strings.Join(valuesStr, " "))
}
