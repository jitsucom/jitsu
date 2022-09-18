package logevents

import (
	"io"
	"path"

	"github.com/jitsucom/jitsu/server/logging"
)

const (
	ArchiveDir  = "archive"
	FailedDir   = "failed"
	IncomingDir = "incoming"
	RetiredDir  = "retired"
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

func NewFactory(logEventPath string, logRotationMin int64, showInServer bool,
	ddlLogsWriter io.Writer, queryLogsWriter io.Writer, asyncLoggers bool, asyncLoggerPoolSize int) *Factory {
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

//NewFactoryWithDDLLogsWriter returns a new factory instance with overridden DDL debug logs writer
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

//NewFactoryWithQueryLogsWriter returns a new factory instance with overridden sql query debug logs writer
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

func (f *Factory) CreateSQLQueryLogger(destinationName string) *logging.QueryLogger {
	return logging.NewQueryLogger(destinationName, f.ddlLogsWriter, f.queryLogsWriter)
}

func (f *Factory) CreateIncomingLogger(tokenID string) logging.ObjectLogger {
	return f.createLogger(IncomingDir, "incoming.tok="+tokenID, f.showInServer)
}

func (f *Factory) CreateFailedLogger(destinationName string) logging.ObjectLogger {
	return f.createLogger(FailedDir, "failed.dst="+destinationName, false)
}

func (f *Factory) CreateRetiredLogger(destinationName string) logging.ObjectLogger {
	return f.createLogger(RetiredDir, "retired.dst="+destinationName, false)
}

func (f *Factory) CreateStreamingArchiveLogger(destinationName string) logging.ObjectLogger {
	return f.createLogger(ArchiveDir, "streaming-archive.dst="+destinationName, false)
}

func (f *Factory) CreateWriteAheadLogger() logging.ObjectLogger {
	return f.createLogger(IncomingDir, "write-ahead-log", false)
}

func (f *Factory) createLogger(subDir, fileName string, showInGlobalLogger bool) logging.ObjectLogger {
	logWriter := logging.NewRollingWriter(&logging.Config{
		FileName:      fileName,
		FileDir:       path.Join(f.logEventPath, subDir),
		RotationMin:   f.logRotationMin,
		RotateOnClose: true,
	})

	if f.asyncLoggers {
		return NewAsyncLogger(logWriter, showInGlobalLogger, f.asyncLoggerPoolSize)
	}

	return NewSyncLogger(logWriter, showInGlobalLogger)
}
