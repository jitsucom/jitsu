package main

import (
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jitsucom/bulker/bulkerlib/implementations/api_based"
	_ "github.com/jitsucom/bulker/bulkerlib/implementations/file_storage"
	_ "github.com/jitsucom/bulker/bulkerlib/implementations/sql"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/sync-sidecar/db"
	"net/http"
	_ "net/http/pprof"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
)

var logLevels = map[string]int{
	"TRACE": -2,
	"DEBUG": -1,
	"INFO":  0,
	"WARN":  1,
	"ERROR": 2,
	"FATAL": 3,
}

type SideCar interface {
	Run()
	Close()
}

type AbstractSideCar struct {
	syncId     string
	taskId     string
	storageKey string
	command    string

	packageName    string
	packageVersion string

	stdOutPipeFile string
	stdErrPipeFile string

	logLevel   string
	dbLogLevel string

	databaseURL      string
	dbpool           *pgxpool.Pool
	eventsLogService eventslog.EventsLogService

	startedBy string
	startedAt time.Time

	//first error occurred during command
	firstErr         error
	taskTimeoutHours int

	errPipe   *os.File
	outPipe   *os.File
	cancelled atomic.Bool
}

func (s *AbstractSideCar) Close() {
	s._log("jitsu", "WARN", "Cancelling...")
	s.cancelled.Store(true)
	if s.outPipe != nil {
		_ = s.outPipe.Close()
	}
	if s.errPipe != nil {
		_ = s.errPipe.Close()
	}
}

func main() {
	startedAt, err := time.Parse(time.RFC3339, os.Getenv("STARTED_AT"))
	if err != nil {
		startedAt = time.Now()
	}

	command := os.Getenv("COMMAND")
	var sidecar SideCar
	taskTimeoutHours, _ := strconv.Atoi(utils.DefaultString(os.Getenv("TASK_TIMEOUT_HOURS"), "48"))
	abstract := &AbstractSideCar{
		syncId:           os.Getenv("SYNC_ID"),
		taskId:           os.Getenv("TASK_ID"),
		command:          os.Getenv("COMMAND"),
		storageKey:       os.Getenv("STORAGE_KEY"),
		packageName:      os.Getenv("PACKAGE"),
		packageVersion:   os.Getenv("PACKAGE_VERSION"),
		stdOutPipeFile:   os.Getenv("STDOUT_PIPE_FILE"),
		stdErrPipeFile:   os.Getenv("STDERR_PIPE_FILE"),
		databaseURL:      os.Getenv("DATABASE_URL"),
		eventsLogService: &eventslog.DummyEventsLogService{},
		logLevel:         strings.ToUpper(utils.DefaultString(os.Getenv("LOG_LEVEL"), "INFO")),
		dbLogLevel:       strings.ToUpper(utils.DefaultString(os.Getenv("DB_LOG_LEVEL"), "INFO")),
		startedAt:        startedAt,
		taskTimeoutHours: taskTimeoutHours,
	}
	clickhouseURL := os.Getenv("CLICKHOUSE_URL")
	clickhouseHost := os.Getenv("CLICKHOUSE_HOST")
	if clickhouseURL != "" || clickhouseHost != "" {
		eventsLogConfig := eventslog.EventsLogConfig{
			ClickhouseURL:      clickhouseURL,
			ClickhouseHost:     clickhouseHost,
			ClickhouseDatabase: os.Getenv("CLICKHOUSE_DATABASE"),
			ClickhouseUsername: os.Getenv("CLICKHOUSE_USERNAME"),
			ClickhousePassword: os.Getenv("CLICKHOUSE_PASSWORD"),
			ClickhouseSSL:      os.Getenv("CLICKHOUSE_SSL") == "true",
		}
		eventsLogService, err := eventslog.NewClickhouseEventsLog(eventsLogConfig)
		if err != nil {
			logging.Errorf("Unable to create clickhouse events log: %v", err)
		} else {
			abstract.eventsLogService = eventsLogService
		}
	}
	if command == "read" {
		sidecar = &ReadSideCar{AbstractSideCar: abstract,
			namespace:       os.Getenv("NAMESPACE"),
			functionsEnv:    os.Getenv("FUNCTIONS_ENV"),
			tableNamePrefix: os.Getenv("TABLE_NAME_PREFIX"),
			toSameCase:      os.Getenv("TO_SAME_CASE") == "true",
			addMeta:         os.Getenv("ADD_META") == "true",
			deduplicate:     os.Getenv("DEDUPLICATE") == "true" || os.Getenv("DEDUPLICATE") == "",
		}
	} else {
		sidecar = &SpecCatalogSideCar{AbstractSideCar: abstract}
	}

	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGTERM)

	go func() {
		_ = http.ListenAndServe("localhost:6060", nil)
	}()

	go func() {
		sig := <-sigs
		logging.Infof("Received signal: %s. Shutting down...", sig)
		sidecar.Close()
	}()

	sidecar.Run()

}

func (s *AbstractSideCar) log(message string, args ...any) {
	s._log("jitsu", "INFO", fmt.Sprintf(message, args...))
}

func (s *AbstractSideCar) sourceLog(level, message string, args ...any) {
	message = strings.TrimPrefix(message, "INFO ")
	message = strings.TrimPrefix(message, "ERROR ")
	message = strings.TrimPrefix(message, "WARN ")
	message = strings.TrimPrefix(message, "DEBUG ")
	message = strings.TrimPrefix(message, "FATAL ")

	text := fmt.Sprintf(message, args...)
	if level == "ERROR" || level == "FATAL" {
		s.registerErr(errors.New(text))
	}
	s._log(s.packageName, level, text)
}

func (s *AbstractSideCar) err(message string, args ...any) {
	text := fmt.Sprintf(message, args...)
	s.registerErr(errors.New(text))
	s._log("jitsu", "ERROR", text)
}

func (s *AbstractSideCar) panic(message string, args ...any) {
	text := fmt.Sprintf(message, args...)
	s.registerErr(errors.New(text))
	s._log("jitsu", "ERROR", text)
	panic(text)
}

func (s *AbstractSideCar) isErr() bool {
	return s.firstErr != nil
}

func (s *AbstractSideCar) registerErr(err error) {
	if s.firstErr == nil {
		s.firstErr = err
	}
}

func (s *AbstractSideCar) checkJsonRow(json string) bool {
	json = strings.TrimSpace(json)
	if strings.HasPrefix(json, "{") && strings.HasSuffix(json, "}") {
		return true
	}
	//get first word
	logLine := strings.SplitN(json, " ", 2)
	firstWord := logLine[0]
	rest := ""
	if len(logLine) > 1 {
		rest = logLine[1]
	}
	switch strings.ToLower(firstWord) {
	case "info", "error", "warn", "debug", "fatal", "trace":
		s._log(s.packageName, firstWord, rest)
	default:
		s._log(s.packageName, "ERROR", json)
	}
	return false
}

func (s *AbstractSideCar) _log(logger, level, message string) {
	if shouldLog(strings.ToUpper(level), s.logLevel) {
		fmt.Printf("%s : %s\n", level, message)
	}
	if shouldLog(strings.ToUpper(level), s.dbLogLevel) {
		err := s.sendLog(logger, level, message)
		if err != nil {
			fmt.Printf("%s: %v\n", level, err)
		}
	}
}

func (s *AbstractSideCar) sendLog(logger, level string, message string) error {
	if s.eventsLogService != nil && strings.Contains(s.eventsLogService.Id(), "clickhouse") {
		return s.eventsLogService.InsertTaskLog(level, logger, message, s.syncId, s.taskId, time.Now())
	} else {
		return db.InsertTaskLog(s.dbpool, uuid.New().String(), level, logger, message, s.syncId, s.taskId, time.Now())
	}
}

func shouldLog(level string, enabledLevel string) bool {
	return logLevels[level] >= logLevels[enabledLevel]
}

func joinStrings(str1, str2, sep string) string {
	if str1 == "" {
		return str2
	} else if str2 == "" {
		return str1
	}

	return str1 + sep + str2
}
