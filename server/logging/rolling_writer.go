package logging

import (
	"io"
	"path/filepath"
	"regexp"
	"sync/atomic"
	"time"

	"github.com/google/martian/log"
	"github.com/jitsucom/jitsu/server/safego"
	"gopkg.in/natefinch/lumberjack.v2"
)

const (
	logFileMaxSizeMB         = 100
	twentyFourHoursInMinutes = 1440
)

// TokenIDExtractRegexp is a regex for reading already rotated and closed log files
var TokenIDExtractRegexp = regexp.MustCompile("incoming.tok=(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

// RollingWriterProxy for lumberjack.Logger
// Rotate() only if file isn't empty
type RollingWriterProxy struct {
	lWriter       *lumberjack.Logger
	rotateOnClose bool

	records uint64
}

func CreateLogWriter(config *Config) io.Writer {
	if config.FileDir != GlobalType {
		return NewRollingWriter(config)
	} else {
		return GlobalLogsWriter
	}
}

func NewRollingWriter(config *Config) io.WriteCloser {
	fileNamePath := filepath.Join(config.FileDir, config.FileName+".log")
	maxSize := config.MaxFileSizeMb
	if maxSize == 0 {
		maxSize = logFileMaxSizeMB
	}
	lWriter := &lumberjack.Logger{
		Filename: fileNamePath,
		MaxSize:  maxSize,
		Compress: config.Compress,
	}
	if config.MaxBackups > 0 {
		lWriter.MaxBackups = config.MaxBackups
	}

	rwp := &RollingWriterProxy{lWriter: lWriter, records: 0, rotateOnClose: config.RotateOnClose}

	if config.RotationMin == 0 {
		config.RotationMin = twentyFourHoursInMinutes
	}
	rotation := time.Duration(config.RotationMin) * time.Minute

	ticker := time.NewTicker(rotation)
	safego.RunWithRestart(func() {
		//initial rotate
		if err := rwp.lWriter.Rotate(); err != nil {
			log.Errorf("Error initial rotating log file [%s]: %v", rwp.lWriter.Filename, err)
		}
		for {
			<-ticker.C
			rwp.rotate()
		}
	})

	return rwp
}

func (rwp *RollingWriterProxy) rotate() {
	if atomic.SwapUint64(&rwp.records, 0) > 0 {
		if err := rwp.lWriter.Rotate(); err != nil {
			log.Errorf("Error rotating log file [%s]: %v", rwp.lWriter.Filename, err)
		}
	}
}

func (rwp *RollingWriterProxy) Write(p []byte) (int, error) {
	atomic.AddUint64(&rwp.records, 1)
	return rwp.lWriter.Write(p)
}

func (rwp *RollingWriterProxy) Close() error {
	if rwp.rotateOnClose {
		rwp.rotate()
	}

	return rwp.lWriter.Close()
}
