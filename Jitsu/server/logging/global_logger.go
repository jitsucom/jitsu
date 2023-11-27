package logging

import (
	"errors"
	"fmt"
	"io"
	"log"
	"strings"

	"github.com/gookit/color"
	"github.com/jitsucom/jitsu/server/notifications"
)

const (
	errPrefix   = "[ERROR]:"
	warnPrefix  = "[WARN]:"
	infoPrefix  = "[INFO]:"
	debugPrefix = "[DEBUG]:"

	GlobalType = "global"
)

var GlobalLogsWriter io.Writer
var ConfigErr string
var ConfigWarn string

var LogLevel = UNKNOWN

type Config struct {
	FileName      string
	FileDir       string
	RotationMin   int64
	MaxBackups    int
	MaxFileSizeMb int
	Compress      bool

	RotateOnClose bool
}

func (c Config) Validate() error {
	if c.FileName == "" {
		return errors.New("Logger file name can't be empty")
	}
	if c.FileDir == "" {
		return errors.New("Logger file dir can't be empty")
	}

	return nil
}

// InitGlobalLogger initializes main logger
func InitGlobalLogger(writer io.Writer, levelStr string) error {
	dateTimeWriter := DateTimeWriterProxy{
		writer: writer,
	}
	log.SetOutput(dateTimeWriter)
	log.SetFlags(0)

	LogLevel = ToLevel(levelStr)

	if ConfigErr != "" {
		Error(ConfigErr)
	}

	if ConfigWarn != "" {
		Warn(ConfigWarn)
	}
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
	if LogLevel <= ERROR {
		log.Println(errMsg(v...))
	}
}

func Infof(format string, v ...interface{}) {
	Info(fmt.Sprintf(format, v...))
}

func Info(v ...interface{}) {
	if LogLevel <= INFO {
		log.Println(append([]interface{}{infoPrefix}, v...)...)
	}
}

func Debugf(format string, v ...interface{}) {
	Debug(fmt.Sprintf(format, v...))
}

func Debug(v ...interface{}) {
	if LogLevel <= DEBUG {
		log.Println(append([]interface{}{debugPrefix}, v...)...)
	}
}

func Warnf(format string, v ...interface{}) {
	Warn(fmt.Sprintf(format, v...))
}

func Warn(v ...interface{}) {
	if LogLevel <= WARN {
		log.Println(append([]interface{}{warnPrefix}, v...)...)
	}
}

func Fatal(v ...interface{}) {
	if LogLevel <= FATAL {
		log.Fatal(errMsg(v...))
	}
}

func Fatalf(format string, v ...interface{}) {
	if LogLevel <= FATAL {
		log.Fatalf(errMsg(fmt.Sprintf(format, v...)))
	}
}

func errMsg(values ...interface{}) string {
	valuesStr := []string{errPrefix}
	for _, v := range values {
		valuesStr = append(valuesStr, fmt.Sprint(v))
	}
	return color.Red.Sprint(strings.Join(valuesStr, " "))
}
