package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations/sql"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	types2 "github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/sync-sidecar/db"
)

const interruptError = "Stream was interrupted. Check logs for errors."
const somethingWentWrongError = "Something went wrong in the connector. See the logs for more details."
const cancelledError = "Sync job was cancelled"

var forceTemporaryBatchesDestinations = map[string]int{
	"webhook": 100,
	"duckdb":  10000,
}

type ReadSideCar struct {
	*AbstractSideCar
	namespace       string
	functionsEnv    string
	tableNamePrefix string
	toSameCase      bool
	addMeta         bool
	deduplicate     bool

	lastMessageTime atomic.Int64
	bulkerStartTime atomic.Int64
	// downstreamBusy counts in-flight non-commit downstream calls (bulker
	// Consume per record and state DB writes). The watchdog ORs this with
	// bulkerStartTime: while either is non-zero, the sidecar is actively
	// pushing data and the source has likely gone silent because its FIFO
	// write is blocked — not because it's dead. Without this gate a slow
	// destination during Consume, or a slow Postgres during state save,
	// can starve lastMessageTime and trip the 2h watchdog falsely.
	downstreamBusy atomic.Int64
	// processRecordStart records the unix-time when the stdout reader
	// entered bulker Consume (0 when not in one). The watchdog uses it to
	// catch a wedged Consume against a slow destination — a hazard that
	// would otherwise hide behind the downstreamBusy gate. State DB writes
	// don't need an equivalent: the dbpool is configured with a 2-minute
	// statement_timeout, so a stuck UpsertState fails fast with an error.
	processRecordStart atomic.Int64
	lastStateMessage  string
	blk               bulker.Bulker
	lastStream        *ActiveStream
	processedStreams  map[string]*ActiveStream
	catalog           *jsonorder.OrderedMap[string, *Stream]
	destinationConfig map[string]any
	initialState      string
	fullSync          bool
	eventsCounter     int
	bytesCounter      int
}

func (s *ReadSideCar) Run() {
	var err error

	// Bound every query at 2 minutes — the sidecar only does small metadata
	// writes (task_log, source_task, source_state). Any stuck Postgres call
	// fails fast with a cancellation error instead of blocking the stdout
	// reader indefinitely on a wedged connection.
	s.dbpool, err = pg.NewPGPool(s.databaseURL, pg.WithStatementTimeout(2*time.Minute))
	if err != nil {
		s.panic("Unable to create postgres connection pool: %v", err)
	}
	defer s.dbpool.Close()

	s.log("Sidecar. command: read. syncId: %s, taskId: %s, package: %s:%s startedAt: %s", s.syncId, s.taskId, s.packageName, s.packageVersion, s.startedAt.Format(time.RFC3339))

	s.relayInitContainerLogs()
	s.fullSync = os.Getenv("FULL_SYNC") == "true"
	if s.fullSync {
		s.log("Running in Full Sync mode")
	}

	s.lastMessageTime.Store(time.Now().Unix())

	defer func() {
		cancelled := s.cancelled.Load()
		timeExceeded := cancelled && time.Now().Sub(s.startedAt) > time.Hour*time.Duration(s.taskTimeoutHours)
		if r := recover(); r != nil {
			s.registerErr(fmt.Errorf("%v", r))
			s.closeActiveStreams(false)
		} else {
			s.closeActiveStreams(!cancelled && !s.isCriticalError())
		}
		if len(s.processedStreams) > 0 {
			statusMap := jsonorder.NewOrderedMap[string, any](0)
			s.catalog.ForEach(func(streamName string, _ *Stream) {
				if stream, ok := s.processedStreams[streamName]; ok {
					statusMap.Set(streamName, stream.StreamStat)
				} else {
					if timeExceeded {
						statusMap.Set(streamName, &StreamStat{Status: "TIME_EXCEEDED"})
					} else if cancelled {
						statusMap.Set(streamName, &StreamStat{Status: "CANCELLED"})
					} else {
						statusMap.Set(streamName, &StreamStat{Status: "FAILED", Error: "Stream was not processed. Check logs for errors."})
					}
				}
			})
			allSuccess := true
			allFailed := true
			statusMap.ForEach(func(_ string, streamStat any) {
				st := streamStat.(*StreamStat)
				if st.Status != "SUCCESS" {
					allSuccess = false
				}
				if st.Status != "FAILED" {
					allFailed = false
				}
			})
			status := "PARTIAL"
			errorText := ""
			if allSuccess {
				status = "SUCCESS"
			} else if allFailed {
				status = "FAILED"
			} else if timeExceeded {
				status = "TIME_EXCEEDED"
				errorText = fmt.Sprintf("Task timeout: The task has been running for more than %d hours. Consider splitting the selected streams into multiple Sync entities.", s.taskTimeoutHours)
			} else if cancelled {
				status = "CANCELLED"
				errorText = "The task was cancelled"
			} else if s.firstErr != nil {
				errorText = "ERROR: " + s.firstErr.Error()
			}

			if allFailed && s.firstErr != nil {
				s.sendBadStatus("FAILED", "ERROR: "+s.firstErr.Error())
			} else {
				processedStreamsJson, _ := jsonorder.Marshal(statusMap)
				s.sendGoodStatus(status, string(processedStreamsJson), errorText, true)
			}
		} else if s.isErr() {
			s.sendBadStatus("FAILED", "ERROR: "+s.firstErr.Error())
			os.Exit(1)
		} else if timeExceeded {
			s.sendBadStatus("TIME_EXCEEDED", fmt.Sprintf("Task timeout: task is running for more than %d hours.", s.taskTimeoutHours))
		} else if cancelled {
			s.sendBadStatus("CANCELLED", "The task was cancelled")
		} else {
			s.sendGoodStatus("SUCCESS", "", "", true)
		}
	}()
	ticker := time.NewTicker(15 * time.Minute)
	defer ticker.Stop()
	go func() {
		for range ticker.C {
			now := time.Now().Unix()
			// Specific stuck-call checks first so the panic message points
			// at the actual blocked syscall (vs. a generic "no messages").
			if start := s.processRecordStart.Load(); start != 0 && now-start > 8000 {
				s.panic("processRecord (bulker Consume) stuck for more than 2 hours. Exiting")
			}
			// Gate the source-silence panic on three signals: no commit in
			// flight (bulkerStartTime), no per-record/state downstream work
			// in flight (downstreamBusy), and >2h since the last sign of life
			// (lastMessageTime — stdout, stderr, or commit completion). If
			// any downstream path is active the source is likely blocked
			// writing into a full FIFO, not stuck — don't kill the pod.
			if s.bulkerStartTime.Load() == 0 && s.downstreamBusy.Load() == 0 && now-s.lastMessageTime.Load() > 8000 {
				s.panic("No messages from %s for 2 hours. Exiting", s.packageName)
			}
		}
	}()

	err = s.loadDestinationConfig()
	if err != nil {
		s.panic("Error loading destination config: %v", err)
	}
	blk, err := bulker.CreateBulker(bulker.Config{
		Id:                fmt.Sprintf("%s_%s", s.syncId, s.taskId),
		BulkerType:        s.destinationConfig["destinationType"].(string),
		DestinationConfig: s.destinationConfig,
	})
	if err != nil {
		s.panic("Error creating bulker: %v", err)
	}
	s.blk = blk
	err = s.loadCatalog()
	if err != nil {
		s.panic("Error loading catalog: %v", err)
	}
	s.log("Catalog loaded. %d streams selected", s.catalog.Len())
	state, ok := s.loadState()
	if ok {
		s.log("State loaded: %s", state)
	}
	// Materialize the source_task row up front so the UI sees the run as
	// soon as the sidecar boots. Without this the row only appears when
	// the source connector emits its first STREAM_STATUS=STARTED trace or
	// hits a commit (updateRunningStatus), which for slow-starting sources
	// (heavy discovery, large initial API calls) can be 10+ minutes after
	// the pod started — and syncctl's RUNNING heartbeats are UPDATE-only,
	// so they silently no-op until something INSERTs.
	s.updateRunningStatus()
	var stdOutErrWaitGroup sync.WaitGroup

	s.errPipe, _ = os.Open(s.stdErrPipeFile)
	defer s.errPipe.Close()
	stdOutErrWaitGroup.Add(1)
	// read from stderr
	go func() {
		defer stdOutErrWaitGroup.Done()
		scanner := bufio.NewScanner(s.errPipe)
		scanner.Buffer(make([]byte, 1024*10), 1024*1024*10)
		for scanner.Scan() {
			// Source stderr counts as liveness: Python/Java connectors emit
			// their normal logging (progress, rate-limit waits, retries) on
			// stderr while RECORD/STATE/TRACE go to stdout. Without this the
			// watchdog could falsely trip when the sidecar's stdout reader
			// is busy (Consume/state save) and the source is fully chatty
			// on stderr.
			s.lastMessageTime.Store(time.Now().Unix())
			line := scanner.Text()
			s.sourceLog("ERRSTD", line)
		}
		if err := scanner.Err(); err != nil && !s.cancelled.Load() {
			s.panic("error reading from err pipe: %v", err)
		}
	}()

	s.processedStreams = map[string]*ActiveStream{}
	s.outPipe, _ = os.Open(s.stdOutPipeFile)
	defer s.outPipe.Close()
	if s.cancelled.Load() {
		return
	}
	stdOutErrWaitGroup.Add(1)
	// read from stdout
	go func() {
		defer stdOutErrWaitGroup.Done()

		scanner := bufio.NewScanner(s.outPipe)
		scanner.Buffer(make([]byte, 1024*10), 1024*1024*100)
		for scanner.Scan() {
			s.lastMessageTime.Store(time.Now().Unix())
			line := scanner.Bytes()
			lineStr := string(line)
			ok = s.checkJsonRow(lineStr)
			if !ok {
				continue
			}
			row := &Row{}
			err := jsonorder.Unmarshal(line, row)
			if err != nil {
				s._log("jitsu", "ERROR", fmt.Sprintf("error parsing airbyte line %s: %v", string(line), err))
				s.sourceLog("INFO", lineStr)
				continue
			}
			switch row.Type {
			case LogType:
				if row.Log.Level == "ERROR" || row.Log.Level == "FATAL" {
					stream, ok := s.getSolelyRunningStream()
					if ok && stream != nil {
						stream.errorFromLogs = row.Log.Message
					}
				}
				level := strings.ToUpper(row.Log.Level)
				if shouldLog(level, s.logLevel) || shouldLog(level, s.dbLogLevel) {
					s.sourceLog(row.Log.Level, row.Log.Message)
				}
			case DebugType:
				message := row.Message
				if row.Data != nil {
					jsonData, _ := jsonorder.Marshal(row.Data)
					sData := string(jsonData)
					if sData != "" && sData != "{}" {
						message = fmt.Sprintf("%s: %s", message, sData)
					}
				}
				if shouldLog("DEBUG", s.logLevel) || shouldLog("DEBUG", s.dbLogLevel) {
					s.sourceLog("DEBUG", message)
				}
			case StateType:
				if s.lastStateMessage != lineStr {
					s.processState(row.State)
					s.lastStateMessage = lineStr
				}
			case RecordType:
				s.processRecord(row.Record, len(line))
			case TraceType:
				s.processTrace(row.Trace, lineStr)
			case ControlType:
				s.sourceLog("WARN", "Control messages are not supported and ignored: %s", lineStr)
			default:
				s.panic("not supported Airbyte message type: %s: %s", row.Type, lineStr)
			}
		}
		if err := scanner.Err(); err != nil && !s.cancelled.Load() {
			s.panic("error reading from pipe: %v", err)
		}
	}()
	stdOutErrWaitGroup.Wait()
}

func (s *ReadSideCar) getSolelyRunningStream() (*ActiveStream, bool) {
	var first *ActiveStream
	for _, stream := range s.processedStreams {
		if stream.Status == "RUNNING" {
			if first == nil {
				first = stream
			} else {
				return nil, false
			}
		}
	}
	return first, first != nil
}

func (s *ReadSideCar) processState(state *StateRow) {
	//checkpointing. commit to bulker all processed events on saving state
	switch state.Type {
	case "GLOBAL":
		s.checkpointIfNecessary(s.lastStream)
		s.saveState("_GLOBAL_STATE", state.GlobalState)
	case "STREAM":
		streamName := joinStrings(state.StreamState.StreamDescriptor.Namespace, state.StreamState.StreamDescriptor.Name, ".")
		var ok bool
		stream, ok := s.processedStreams[streamName]
		if ok && stream != nil {
			stream.unsavedState = state.StreamState.StreamState
			s.checkpointIfNecessary(stream)
		}
	case "LEGACY", "":
		s.checkpointIfNecessary(s.lastStream)
		s.saveState("_LEGACY_STATE", state.Data)
	}
}

func (s *ReadSideCar) saveState(stream string, data any) {
	if data == nil {
		return
	}
	if stream != "_LEGACY_STATE" && stream != "_GLOBAL_STATE" {
		processed, ok := s.processedStreams[stream]
		if !ok {
			s.errprint("STATE: cannot save state for stream '%s' because it was not processed", stream)
			return
		}
		if processed.Error != "" {
			s.errprint("STATE: not saving state for stream '%s' because of previous errors", stream)
			return
		}
	} else {
		if s.isCriticalError() {
			s.errprint("STATE: not saving '%s' state because of previous errors", stream)
			return
		}
	}
	stateJson, err := jsonorder.Marshal(data)
	if err != nil {
		s.panic("error marshalling state %+v: %v", data, err)
	}
	s.log("SAVING STATE for '%s': %s", stream, utils.ShortenStringWithEllipsisMiddle(string(stateJson), 255, "\n...\n"))
	s.storeState(stream, string(stateJson))
}

func (s *ReadSideCar) closeStream(streamName string, complete bool) {
	stream, ok := s.processedStreams[streamName]
	if !ok || stream == nil {
		s.errprint("Stream '%s' is not in processed streams", streamName)
		return
	}
	s._closeStream(stream, complete, false)
}

func (s *ReadSideCar) manageBulkerTimeout(eventsCount int) func() {
	s.bulkerStartTime.Store(time.Now().Unix())
	period := time.Duration(max(eventsCount/185, 3600)) * time.Second
	timer := time.NewTimer(period)
	go func() {
		t := <-timer.C
		if !t.IsZero() {
			s.panic("Bulker is running for more than %s. Exiting", period)
		}
	}()
	return func() {
		timer.Stop()
		s.lastMessageTime.Store(time.Now().Unix())
		s.bulkerStartTime.Store(0)
	}
}

func (s *ReadSideCar) checkpointIfNecessary(stream *ActiveStream) {
	if stream == nil {
		return
	}
	// for successfully closed stream it is safe to save state
	// otherwise we save state only after commit to warehouse
	if stream.Status == "SUCCESS" {
		s.saveState(stream.name, stream.unsavedState)
		stream.unsavedState = nil
		return
	}
	if !stream.IsActive() {
		return
	}
	if stream.bufferedEventsCount >= 500000 || (stream.mode == "incremental" && !s.fullSync) {
		defer s.manageBulkerTimeout(stream.bufferedEventsCount)()
		state := stream.Commit(false)
		state.ProcessingTimeSec = time.Since(stream.started).Seconds()
		if stream.Error != "" {
			s.postEventsLog(s.syncId, state, stream.processedObjectSample, stream.Error)
			s.errprint("Stream '%s' bulker commit failed: %v", stream.name, stream.Error)
		} else {
			if state.ProcessedRows > 0 || stream.bulkerMode == bulker.ReplaceTable {
				s.postEventsLog(s.syncId, state, stream.processedObjectSample, "")
			}
			s.saveState(stream.name, stream.unsavedState)
			stream.unsavedState = nil
			s.log("Stream '%s' bulker commit: %s rows: %d successful: %d", stream.name, state.Status, state.ProcessedRows, state.SuccessfulRows)
		}
		s.updateRunningStatus()
	}
	return
}

type BatchState struct {
	bulker.State  `json:",inline"`
	LastMappedRow types2.Json `json:"lastMappedRow"`
}

func (s *ReadSideCar) postEventsLog(destinationId string, state bulker.State, processedObjectSample types2.Json, batchErr string) {
	if batchErr != "" && state.LastError == nil {
		state.SetError(errors.New(batchErr))
	}
	batchState := BatchState{State: state, LastMappedRow: processedObjectSample}
	level := eventslog.LevelInfo
	if batchErr != "" {
		level = eventslog.LevelError
	}
	_, err := s.eventsLogService.PostEvent(&eventslog.ActorEvent{Timestamp: time.Now().UTC(), EventType: eventslog.EventTypeBatch, Level: level, ActorId: destinationId, Event: batchState})
	if err != nil {
		s.errprint("Error posting events log: %v", err)
	}

}

func (s *ReadSideCar) _closeStream(stream *ActiveStream, complete bool, strict bool) {
	wasActive := stream.IsActive()
	defer s.manageBulkerTimeout(stream.bufferedEventsCount)()
	state := stream.Close(complete, s.cancelled.Load(), strict)
	state.ProcessingTimeSec = time.Since(stream.started).Seconds()
	if stream.Error != "" {
		s.postEventsLog(s.syncId, state, stream.processedObjectSample, stream.Error)
		s.errprint("Stream '%s' bulker commit failed: %v", stream.name, stream.Error)
	} else if wasActive {
		if state.ProcessedRows > 0 || stream.bulkerMode == bulker.ReplaceTable {
			s.postEventsLog(s.syncId, state, stream.processedObjectSample, "")
		}
		s.log("Stream '%s' bulker commit: %s rows: %d successful: %d", stream.name, state.Status, state.ProcessedRows, state.SuccessfulRows)
	}
	if complete {
		s.saveState(stream.name, stream.unsavedState)
		stream.unsavedState = nil
	}
	s.log("Stream '%s' closed: status: %s rows: %d", stream.name, stream.Status, stream.EventsCount)
}

func (s *ReadSideCar) closeActiveStreams(complete bool) {
	for _, stream := range s.processedStreams {
		if stream.Status == "RUNNING" {
			s._closeStream(stream, complete, true)
		}
	}
}

func (s *ReadSideCar) openStream(streamName string) (*ActiveStream, error) {
	// we create pipe. everything that is written to 'streamWriter' will be sent to bulker via 'streamReader' as reader payload
	str, ok := s.catalog.Get(streamName)
	if !ok {
		err := fmt.Errorf("stream '%s' is not in catalog", streamName)
		return &ActiveStream{name: streamName, StreamStat: &StreamStat{Error: err.Error()}}, err
	}
	stream := s.processedStreams[streamName]
	if stream != nil && stream.Error != "" {
		//for incremental streams we ignore all messages if it was error on previously committed chunks.
		//error may be on bulker side (source may not know about it) and we have no way to command source to switch to the next stream
		return stream, nil
	}
	if stream != nil && stream.IsActive() {
		return stream, nil
	}

	mode := bulker.ReplaceTable
	// if there is no initial sync state, we assume that this is first sync and we need to do full sync
	if str.SyncMode == "incremental" && len(s.initialState) > 0 {
		mode = bulker.Batch
	} else if stream != nil && stream.EventsCount > 0 {
		// checkpointing: if there is previous stats that means that we have committed data because and saved state
		// switch from replace_table to batch mode, to continue adding data to the table
		mode = bulker.Batch
	}
	if stream == nil {
		stream = NewActiveStream(streamName, str.SyncMode, mode)
		s.processedStreams[streamName] = stream
	}
	s.lastStream = stream
	var namespace string
	tableNamePrefix := strings.ReplaceAll(s.tableNamePrefix, "${SOURCE_NAMESPACE}", str.Namespace)
	// Prefer the source-provided table-name template over the raw stream name:
	// stream names may contain characters (e.g. "/") that aren't valid table names.
	defaultTableName := utils.NvlString(str.TableNameTemplate, str.Name)
	tableName := utils.NvlString(str.TableName, tableNamePrefix+defaultTableName)
	if s.namespace == "${LEGACY}" {
		namespace = ""
		tableName = utils.NvlString(str.TableName, tableNamePrefix+utils.NvlString(str.TableNameTemplate, streamName))
	} else {
		namespace = strings.TrimSpace(strings.ReplaceAll(s.namespace, "${SOURCE_NAMESPACE}", str.Namespace))
	}

	jobId := fmt.Sprintf("%s_%s_%s", s.syncId, s.taskId, tableName)

	var streamOptions []bulker.StreamOption
	if s.deduplicate && len(str.GetPrimaryKeys()) > 0 {
		streamOptions = append(streamOptions, bulker.WithPrimaryKey(str.GetPrimaryKeys()...), bulker.WithDeduplicate())
	}
	schema := str.ToSchema()
	//s.log("Schema: %+v", schema)
	if len(schema.Fields) > 0 {
		streamOptions = append(streamOptions, bulker.WithSchema(schema))
	}
	if len(str.CursorField) > 0 {
		streamOptions = append(streamOptions, bulker.WithDiscriminatorField(str.CursorField))
	} else if len(str.DefaultCursorField) > 0 {
		streamOptions = append(streamOptions, bulker.WithDiscriminatorField(str.DefaultCursorField))
	}

	streamOptions = append(streamOptions, sql.WithDisableTemporaryTables())
	if size, ok := forceTemporaryBatchesDestinations[s.blk.Type()]; ok {
		streamOptions = append(streamOptions, bulker.WithTemporaryBatchSize(size))
	} else {
		// during sync we don't use TEMPORARY tables in databases.
		// that allows us to populate tmp table during long period and through multiple transactions
		streamOptions = append(streamOptions, bulker.WithTemporaryBatchSize(100000))
	}

	if namespace != "" {
		streamOptions = append(streamOptions, bulker.WithNamespace(namespace))
	}
	if s.toSameCase {
		streamOptions = append(streamOptions, bulker.WithToSameCase())
	}
	if s.functionsEnv != "" {
		opt, err := bulker.FunctionsEnvOption.Parse(s.functionsEnv)
		if err != nil {
			return stream, fmt.Errorf("error parsing functionsEnv: %v", err)
		}
		streamOptions = append(streamOptions, opt)
	}
	bulkerStream, err := s.blk.CreateStream(jobId, tableName, mode, streamOptions...)
	if err != nil {
		return stream, fmt.Errorf("error creating bulker stream: %v", err)
	}
	s.log("Stream '%s' created bulker. table: %s mode: %s primary keys: %s", streamName, tableName, mode, str.GetPrimaryKeys())

	err = stream.Begin(bulkerStream)
	if err != nil {
		return stream, fmt.Errorf("error starting bulker stream: %v", err)
	}

	return stream, nil
}

func (s *ReadSideCar) processTrace(rec *TraceRow, line string) {
	switch rec.Type {
	case "STREAM_STATUS":
		streamStatus := rec.StreamStatus
		streamName := joinStrings(streamStatus.StreamDescriptor.Namespace, streamStatus.StreamDescriptor.Name, ".")
		s.log("Stream '%s' received status: %s", streamName, streamStatus.Status)
		switch streamStatus.Status {
		case "STARTED":
			stream, err := s.openStream(streamName)
			if err != nil {
				s.streamErr(stream, "error opening stream: %v", err)
			}
			s.updateRunningStatus()
		case "COMPLETE", "INCOMPLETE":
			s.closeStream(streamName, streamStatus.Status == "COMPLETE")
			s.updateRunningStatus()
		}
	case "ERROR":
		r := rec.Error
		streamName := joinStrings(r.StreamDescriptor.Namespace, r.StreamDescriptor.Name, ".")
		if streamName != "" {
			s.errprint("TRACE ERROR '%s': %s", streamName, r.Message)
		} else {
			s.errprint("TRACE ERROR: %s", r.Message)
		}
		s.log("ERROR DETAILS: %+v", r)
		errMsg := r.Message
		if (errMsg == somethingWentWrongError || errMsg == "") && r.InternalMessage != "" {
			errMsg = r.InternalMessage
		}
		streamErr := errMsg
		if streamName != "" {
			stream, ok := s.processedStreams[streamName]
			if ok {
				if (streamErr == somethingWentWrongError || streamErr == "") && stream.errorFromLogs != "" {
					streamErr = stream.errorFromLogs
				}
				stream.RegisterError(fmt.Errorf("%s", streamErr))
			}
		} else {
			if errMsg != somethingWentWrongError && errMsg != "" {
				s.firstErr = fmt.Errorf("%s", errMsg)
			} else if s.firstErr == nil {
				s.firstErr = fmt.Errorf("%s", streamErr)
			}
		}
	default:
		s.log("TRACE: %s", line)
	}
}

func (s *ReadSideCar) processRecord(rec *RecordRow, size int) {
	streamName := joinStrings(rec.Namespace, rec.Stream, ".")
	stream, err := s.openStream(streamName)
	if err != nil {
		s.streamErr(stream, "error opening stream: %v", err)
		return
	}
	row := rec.Data
	if s.addMeta {
		row.Set("_jitsu_timestamp", time.Now().UTC().Format(timestamp.JsonISO))
	}
	// Mark downstream as busy around Consume so the watchdog doesn't false-fire
	// when a slow destination causes the bulker buffer to back up: scanner.Scan
	// stops iterating, lastMessageTime freezes, and the source ends up blocked
	// in write(2) — yet the container appears "running" externally.
	// processRecordStart bounds a genuine stall: the watchdog panics with a
	// specific message if Consume holds for >2h.
	s.processRecordStart.Store(time.Now().Unix())
	s.downstreamBusy.Add(1)
	defer func() {
		s.lastMessageTime.Store(time.Now().Unix())
		s.processRecordStart.Store(0)
		s.downstreamBusy.Add(-1)
	}()
	err = stream.Consume(rec.Data, size)
	if err != nil {
		s.streamErr(stream, "error producing to bulker stream: %v", err)
		return
	}
}

func (s *ReadSideCar) sourceLog(level, message string, args ...any) {
	s.AbstractSideCar.sourceLog(level, message, args...)
}

func (s *ReadSideCar) streamErr(stream *ActiveStream, message string, args ...any) {
	err := fmt.Errorf(message, args...)
	stream.RegisterError(err)
	s._log("jitsu", "ERROR", err.Error())
}

func (s *ReadSideCar) errprint(message string, args ...any) {
	text := fmt.Sprintf(message, args...)
	s._log("jitsu", "ERROR", text)
}

func (s *ReadSideCar) panic(message string, args ...any) {
	s.lastStream.RegisterError(fmt.Errorf(message, args...))
	s.AbstractSideCar.panic(message, args...)
}

func (s *ReadSideCar) storeState(stream, state string) {
	// Same gate as processRecord: a slow Postgres write here can otherwise
	// freeze lastMessageTime while the stdout reader is parked on the DB,
	// the source backs up on its FIFO, and the watchdog misreads the
	// silence as a dead source. No separate stuck-call watchdog needed
	// here — the dbpool's 2-minute statement_timeout bounds the call.
	s.downstreamBusy.Add(1)
	defer func() {
		s.lastMessageTime.Store(time.Now().Unix())
		s.downstreamBusy.Add(-1)
	}()
	err := db.UpsertState(s.dbpool, s.syncId, stream, state, time.Now())
	if err != nil {
		s.panic("error updating state: %v", err)
	}
}

func (s *ReadSideCar) updateRunningStatus() {
	statusMap := jsonorder.NewOrderedMap[string, any](0)
	s.catalog.ForEach(func(streamName string, _ *Stream) {
		if stream, ok := s.processedStreams[streamName]; ok {
			statusMap.Set(streamName, stream.StreamStat)
		} else {
			statusMap.Set(streamName, &StreamStat{Status: "PENDING"})
		}
	})
	processedStreamsJson, _ := jsonorder.Marshal(statusMap)
	s.sendGoodStatus("RUNNING", string(processedStreamsJson), "", false)
}

func (s *ReadSideCar) sendBadStatus(status string, error string) {
	s.errprint("READ %s", joinStrings(status, error, ": "))
	err := db.UpsertTaskError(s.dbpool, s.syncId, s.taskId, s.packageName, s.packageVersion, s.startedAt, status, error)
	if err != nil {
		s.panic("error updating task: %v", err)
	}
}

func (s *ReadSideCar) sendGoodStatus(status string, description, error string, log bool) {
	if log {
		s.log("READ %s", joinStrings(status, description, ": "))
	}
	err := db.UpsertTaskDescriptionAndError(s.dbpool, s.syncId, s.taskId, s.packageName, s.packageVersion, s.startedAt, status, description, error)
	if err != nil {
		s.panic("error updating task: %v", err)
	}
}

// configsPath returns the directory that holds catalog.json, state.json
// and destinationConfig.json for the current run.
//
//   - Default ("/config")   : Secret mount used by the legacy reactive flow.
//   - CONFIGS_PATH overrides : CronJob-driven runs set it to "/shared",
//     an emptyDir written by the oauth-refresh + load-catalog-state init
//     containers (so all run-time inputs sit in one directory regardless
//     of how they got there).
func configsPath() string {
	if p := os.Getenv("CONFIGS_PATH"); p != "" {
		return strings.TrimRight(p, "/")
	}
	return "/config"
}

func (s *ReadSideCar) loadState() (string, bool) {
	statePath := configsPath() + "/state.json"
	if _, err := os.Stat(statePath); os.IsNotExist(err) {
		return "", false
	}
	state, err := os.ReadFile(statePath)
	if err != nil {
		return "", false
	}
	st := strings.TrimSpace(string(state))
	// Treat empty / {} / [] as "no state". `[]` matters for the autonomous
	// CronJob path where the load-catalog-state init writes a JSON document
	// regardless of whether any source_state rows existed.
	if len(st) == 0 || st == "{}" || st == "[]" {
		return "", false
	}
	s.initialState = st
	return st, true
}

func (s *ReadSideCar) loadCatalog() error {
	catalogPath := configsPath() + "/catalog.json"
	if _, err := os.Stat(catalogPath); os.IsNotExist(err) {
		return fmt.Errorf("catalog file %s doesn't exist", catalogPath)
	}
	catalogFile, err := os.ReadFile(catalogPath)
	if err != nil {
		return fmt.Errorf("error opening catalog file: %v", err)
	}
	//s.log("Catalog: %s", string(catalogFile))
	catalog := Catalog{}
	err = jsonorder.Unmarshal(catalogFile, &catalog)
	if err != nil {
		return fmt.Errorf("error parsing catalog file: %v", err)
	}
	mp := jsonorder.NewOrderedMap[string, *Stream](len(catalog.Streams))
	for _, stream := range catalog.Streams {
		mp.Set(joinStrings(stream.Namespace, stream.Name, "."), stream)
	}
	s.catalog = mp
	return nil
}

func (s *ReadSideCar) loadDestinationConfig() error {
	destinationConfigPath := configsPath() + "/destinationConfig.json"
	if _, err := os.Stat(destinationConfigPath); os.IsNotExist(err) {
		return fmt.Errorf("destination config file %s doesn't exist", destinationConfigPath)
	}
	destinationConfigFile, err := os.ReadFile(destinationConfigPath)
	if err != nil {
		return fmt.Errorf("error opening destination config file: %v", err)
	}
	//s.log("Destination config: %s", string(destinationConfigFile))
	var destinationConfig map[string]any
	err = jsonorder.Unmarshal(destinationConfigFile, &destinationConfig)
	if err != nil {
		return fmt.Errorf("error parsing destination config file: %v", err)
	}
	s.destinationConfig = destinationConfig
	return nil
}

// isCriticalError returns true if first error occurred during sync run
// and we consider it as valid reason to tread all streams that haven't received COMPLETE status as FAILED
func (s *ReadSideCar) isCriticalError() bool {
	return s.isErr() && s.packageName != "airbyte/source-netsuite"
}

type StreamStat struct {
	EventsCount    int    `json:"events"`
	BytesProcessed int    `json:"bytes"`
	Status         string `json:"status"`
	Error          string `json:"error,omitempty"`
}

type ActiveStream struct {
	name                string
	mode                string
	bulkerMode          bulker.BulkMode
	bufferedEventsCount int
	bufferedBytes       int
	unsavedState        any
	closed              bool

	bulkerStream          bulker.BulkerStream
	processedObjectSample types2.Json
	started               time.Time
	errorFromLogs         string
	noTrustworthyError    bool
	*StreamStat
}

func NewActiveStream(name, mode string, bulkerMode bulker.BulkMode) *ActiveStream {
	return &ActiveStream{name: name, mode: mode, bulkerMode: bulkerMode, StreamStat: &StreamStat{Status: "RUNNING"}}
}

func (s *ActiveStream) Begin(bulkerStream bulker.BulkerStream) error {
	if s.closed {
		return fmt.Errorf("Stream '%s' is already closed", s.name)
	}
	if s.bulkerStream != nil {
		return fmt.Errorf("Stream '%s' is already started", s.name)
	}
	s.bulkerStream = bulkerStream
	s.Status = "RUNNING"
	s.started = time.Now()
	return nil
}

func (s *ActiveStream) Abort() (state bulker.State) {
	if s == nil {
		return
	}
	if s.bulkerStream != nil {
		state = s.bulkerStream.Abort(context.Background())
	}
	s.bulkerStream = nil
	return
}

// Commit strict - if true, we commit only if there are no errors in logs that could be attributed to that stream
// ( was emitted when only this stream was running )
func (s *ActiveStream) Commit(strict bool) (state bulker.State) {
	if s == nil {
		return
	}
	if s.bulkerStream != nil {
		if s.Error != "" {
			state = s.bulkerStream.Abort(context.Background())
		} else if strict && s.errorFromLogs != "" {
			s.Error = s.errorFromLogs
			state = s.bulkerStream.Abort(context.Background())
		} else {
			var err error
			state, err = s.bulkerStream.Complete(context.Background())
			if err != nil {
				s.Error = err.Error()
			} else {
				s.EventsCount += s.bufferedEventsCount
				s.BytesProcessed += s.bufferedBytes
			}
		}
	}
	s.bufferedEventsCount = 0
	s.bufferedBytes = 0
	s.bulkerStream = nil
	return
}

func (s *ActiveStream) Close(complete, cancelled, strict bool) (state bulker.State) {
	if complete {
		state = s.Commit(strict)
	} else {
		state = s.Abort()
		if s.Error == "" && !cancelled {
			s.Error = utils.NvlString(s.errorFromLogs, interruptError)
			s.noTrustworthyError = true
		}
	}
	if s.Error != "" {
		if s.EventsCount > 0 {
			s.Status = "PARTIAL"
		} else {
			s.Status = "FAILED"
		}
	} else if cancelled {
		if s.EventsCount > 0 {
			s.Status = "PARTIAL"
			s.Error = cancelledError
		} else {
			s.Status = "CANCELLED"
		}
	} else if s.Status == "RUNNING" {
		s.Status = "SUCCESS"
	}
	s.closed = true
	return
}

func (s *ActiveStream) Consume(p *jsonorder.OrderedMap[string, any], originalSize int) error {
	if s.Error != "" {
		return nil
	}
	var err error
	_, s.processedObjectSample, err = s.bulkerStream.Consume(context.Background(), p)
	if err == nil {
		s.bufferedEventsCount++
		s.bufferedBytes += originalSize
	}
	return err
}

func (s *ActiveStream) IsActive() bool {
	return s.bulkerStream != nil && s.Error == ""
}

func (s *ActiveStream) RegisterError(err error) {
	if err != nil && s != nil && (s.Error == "" || s.noTrustworthyError) {
		s.Error = err.Error()
		s.bufferedEventsCount = 0
		s.bufferedBytes = 0
	}
}

// relayInitContainerLogs surfaces output produced by the discover init
// container (and any other init that opts in via `/shared/init-<name>.log`)
// into task_log via the standard sidecar logging path.
//
// Three sources are handled:
//
//   - /shared/discover.stderr: discover's bare stderr (only errors / unparsed
//     output by airbyte convention). Emitted at level STDERR.
//   - /shared/discover.jsonl: discover's stdout as AirbyteMessage JSONL. LOG
//     and TRACE messages are dispatched the same way read.go does it. The
//     CATALOG message is intentionally skipped — load-catalog-state already
//     persisted it and the payload is large.
//   - /shared/init-<name>.log: plain text from any other init container,
//     emitted at INFO under logger=<name>.
//
// Best-effort: read errors are logged and don't fail the read task. Note
// that if discover *failed* this sidecar wouldn't be running (init chain
// stops on first non-zero exit), so this code only runs on the post-success
// path.
func (s *ReadSideCar) relayInitContainerLogs() {
	s.relayDiscoverStderr("/shared/discover.stderr")
	s.relayDiscoverJsonl("/shared/discover.jsonl")

	// Convention: any other init can drop `/shared/init-<name>.log` and it
	// gets relayed under logger=<name>.
	matches, _ := filepath.Glob("/shared/init-*.log")
	for _, p := range matches {
		base := filepath.Base(p)
		name := strings.TrimSuffix(strings.TrimPrefix(base, "init-"), ".log")
		if name == "" {
			name = base
		}
		s.relayPlainLines(p, name, "INFO")
	}
}

// relayPlainLines emits each non-empty line from `path` as a task_log entry
// under (logger, level). Used for generic init-<name>.log artifacts.
func (s *ReadSideCar) relayPlainLines(path, logger, level string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			continue
		}
		s._log(logger, level, line)
	}
}

// relayDiscoverStderr re-emits each non-empty line of discover's stderr.
// Airbyte connectors generally write only errors/unparseable output here, so
// level STDERR matches the spec_catalog convention for stderr stream content.
func (s *ReadSideCar) relayDiscoverStderr(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			continue
		}
		s._log(s.packageName, "STDERR", line)
	}
}

// relayDiscoverJsonl parses discover's stdout (airbyte JSONL) and re-emits
// LOG / TRACE messages the same way read.go's main loop handles them.
// Non-message lines (or lines that fail JSON parse) fall back to checkJsonRow
// so prefix-style "INFO foo" output still gets logged. The CATALOG message
// is skipped (load-catalog-state persisted it; payload is too large for a
// single task_log row).
func (s *ReadSideCar) relayDiscoverJsonl(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		lineStr := strings.TrimSpace(string(line))
		if lineStr == "" {
			continue
		}
		// Non-JSON / prefix-style lines: routed through the same fallback the
		// main read loop uses (logs unprefixed text at ERROR, prefixed text
		// at the prefix's level).
		if !strings.HasPrefix(lineStr, "{") {
			s.checkJsonRow(lineStr)
			continue
		}
		row := &Row{}
		if err := jsonorder.Unmarshal(line, row); err != nil {
			s._log(s.packageName, "WARN", fmt.Sprintf("error parsing discover.jsonl line: %v: %s", err, lineStr))
			continue
		}
		switch row.Type {
		case LogType:
			if row.Log != nil {
				level := strings.ToUpper(row.Log.Level)
				if level == "" {
					level = "INFO"
				}
				s._log(s.packageName, level, row.Log.Message)
			}
		case TraceType:
			if row.Trace == nil {
				continue
			}
			if row.Trace.Type == "ERROR" {
				msg := row.Trace.Error.Message
				if msg == "" {
					msg = row.Trace.Error.InternalMessage
				}
				s._log(s.packageName, "ERROR", msg)
				if row.Trace.Error.StackTrace != "" {
					s._log(s.packageName, "DEBUG", row.Trace.Error.StackTrace)
				}
			} else {
				s._log(s.packageName, "DEBUG", lineStr)
			}
		case CatalogType:
			// Already persisted by load-catalog-state; skip to avoid a huge
			// task_log row.
		case ControlType:
			s._log(s.packageName, "DEBUG", lineStr)
		default:
			// Unexpected for discover (RECORD/STATE/SPEC/CONNECTION_STATUS).
			s._log(s.packageName, "DEBUG", lineStr)
		}
	}
}
