package logging

import (
	"errors"
	"fmt"
	"github.com/gookit/color"
	"github.com/jitsucom/eventnative/notifications"
	"log"
	"strings"
)

const (
	errPrefix  = "[ERROR]:"
	warnPrefix = "[WARN]:"
	infoPrefix = "[INFO]:"
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
//Global logger writes logs and sends system error notifications
func InitGlobalLogger(config Config) error {
	if err := config.Validate(); err != nil {
		return fmt.Errorf("Error while creating global logger: %v", err)
	}
	writer, err := NewWriter(config)
	if err != nil {
		return err
	}
	dateTimeWriter := DateTimeWriterProxy{
		writer: writer,
	}
	log.SetOutput(dateTimeWriter)
	log.SetFlags(0)

	return nil
}

func SystemErrorf(format string, v ...interface{}) {
	SystemError(fmt.Sprintf(format, v...))
}

func SystemError(v ...interface{}) {
	msg := []interface{}{"System error:"}
	msg = append(msg, v...)
	Error(msg...)
	notifications.SystemError(msg...)
}

func Errorf(format string, v ...interface{}) {
	Error(fmt.Sprintf(format, v...))
}

func Error(v ...interface{}) {
	log.Println(errMsg(v...))
}

func Infof(format string, v ...interface{}) {
	Info(fmt.Sprintf(format, v...))
}

func Info(v ...interface{}) {
	log.Println(append([]interface{}{infoPrefix}, v...)...)
}

func Warnf(format string, v ...interface{}) {
	Warn(fmt.Sprintf(format, v...))
}

func Warn(v ...interface{}) {
	log.Println(append([]interface{}{warnPrefix}, v...)...)
}

func Fatal(v ...interface{}) {
	log.Fatal(errMsg(v...))
}

func Fatalf(format string, v ...interface{}) {
	log.Fatalf(format, errMsg(v...))
}

func errMsg(values ...interface{}) string {
	valuesStr := []string{errPrefix}
	for _, v := range values {
		valuesStr = append(valuesStr, fmt.Sprint(v))
	}
	return color.Red.Sprint(strings.Join(valuesStr, " "))
}
