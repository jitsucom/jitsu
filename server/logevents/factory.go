package logevents

import (
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"path"
)

const (
	ArchiveDir  = "archive"
	FailedDir   = "failed"
	IncomingDir = "incoming"
)

type Factory struct {
	logEventPath        string
	logRotationMin      int64
	showInServer        bool
	asyncLoggers        bool
	asyncLoggerPoolSize int

	ddlLogsWriter   io.Writer
	queryLogsWriter io.Writer
}

func NewFactory(logEventPath string, logRotationMin int64, showInServer bool, ddlLogsWriter io.Writer, queryLogsWriter io.Writer,
	asyncLoggers bool, asyncLoggerPoolSize int) *Factory {
	if asyncLoggers {
		var defaultValueMsg string
		if asyncLoggerPoolSize == 0 {
			asyncLoggerPoolSize = 1
			defaultValueMsg = " (value can't be 0. using default value instead)"
		}
		logging.Info("using async logger with pool size: %d%s", asyncLoggerPoolSize, defaultValueMsg)
	}

	return &Factory{
		logEventPath:        logEventPath,
		logRotationMin:      logRotationMin,
		showInServer:        showInServer,
		asyncLoggers:        asyncLoggers,
		asyncLoggerPoolSize: asyncLoggerPoolSize,
		ddlLogsWriter:       ddlLogsWriter,
		queryLogsWriter:     queryLogsWriter,
	}
}

// NewFactoryWithDDLLogsWriter returns a new factory instance with overridden DDL debug logs writer
func (f *Factory) NewFactoryWithDDLLogsWriter(overriddenDDLLogsWriter io.Writer) *Factory {
	return &Factory{
		logEventPath:    f.logEventPath,
		logRotationMin:  f.logRotationMin,
		showInServer:    f.showInServer,
		asyncLoggers:    f.asyncLoggers,
		ddlLogsWriter:   overriddenDDLLogsWriter,
		queryLogsWriter: f.queryLogsWriter,
	}
}

// NewFactoryWithQueryLogsWriter returns a new factory instance with overridden sql query debug logs writer
func (f *Factory) NewFactoryWithQueryLogsWriter(overriddenQueryLogsWriter io.Writer) *Factory {
	return &Factory{
		logEventPath:    f.logEventPath,
		logRotationMin:  f.logRotationMin,
		showInServer:    f.showInServer,
		asyncLoggers:    f.asyncLoggers,
		ddlLogsWriter:   f.ddlLogsWriter,
		queryLogsWriter: overriddenQueryLogsWriter,
	}
}

func (f *Factory) CreateIncomingLogger(tokenID string, rotationMin int) logging.ObjectLogger {
	tokenRotationMin := f.logRotationMin
	if rotationMin > 0 {
		tokenRotationMin = int64(rotationMin)
	}
	eventLogWriter := logging.NewRollingWriter(&logging.Config{
		FileName:      "incoming.tok=" + tokenID,
		FileDir:       path.Join(f.logEventPath, IncomingDir),
		RotationMin:   tokenRotationMin,
		RotateOnClose: true,
	})

	if f.asyncLoggers {
		return NewAsyncLogger(eventLogWriter, f.showInServer, f.asyncLoggerPoolSize)
	}
	return NewSyncLogger(eventLogWriter, f.showInServer)
}

func (f *Factory) CreateFailedLogger(destinationName string) logging.ObjectLogger {
	failedEventWriter := logging.NewRollingWriter(&logging.Config{
		FileName:      "failed.dst=" + destinationName,
		FileDir:       path.Join(f.logEventPath, FailedDir),
		RotationMin:   f.logRotationMin,
		RotateOnClose: true,
	})

	if f.asyncLoggers {
		return NewAsyncLogger(failedEventWriter, false, f.asyncLoggerPoolSize)
	}
	return NewSyncLogger(failedEventWriter, false)
}

func (f *Factory) CreateSQLQueryLogger(destinationName string) *logging.QueryLogger {
	return logging.NewQueryLogger(destinationName, f.ddlLogsWriter, f.queryLogsWriter)
}

func (f *Factory) CreateStreamingArchiveLogger(destinationName string) logging.ObjectLogger {
	archiveWriter := logging.NewRollingWriter(&logging.Config{
		FileName:      "streaming-archive.dst=" + destinationName,
		FileDir:       path.Join(f.logEventPath, ArchiveDir),
		RotationMin:   f.logRotationMin,
		RotateOnClose: true,
	})
	if f.asyncLoggers {
		return NewAsyncLogger(archiveWriter, false, f.asyncLoggerPoolSize)
	}
	return NewSyncLogger(archiveWriter, false)
}

func (f *Factory) CreateWriteAheadLogger() logging.ObjectLogger {
	walWriter := logging.NewRollingWriter(&logging.Config{
		FileName:      "write-ahead-log",
		FileDir:       path.Join(f.logEventPath, IncomingDir),
		RotationMin:   f.logRotationMin,
		RotateOnClose: true,
	})

	if f.asyncLoggers {
		return NewAsyncLogger(walWriter, false, f.asyncLoggerPoolSize)
	}
	return NewSyncLogger(walWriter, false)
}
