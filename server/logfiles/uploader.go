package logfiles

import (
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"time"

	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const parsingErrSrc = "parsing"

var DateExtractRegexp = regexp.MustCompile("incoming.tok=.*-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2})")

// PeriodicUploader read already rotated and closed log files
// Pass them to storages according to tokens
// Keep uploading log file with result statuses
type PeriodicUploader struct {
	logIncomingEventPath string
	fileMask             string
	uploadEvery          time.Duration

	archiver           *Archiver
	statusManager      *StatusManager
	destinationService *destinations.Service
}

// NewUploader returns new configured PeriodicUploader instance
func NewUploader(logEventPath, fileMask string, uploadEveryMin int, destinationService *destinations.Service) (*PeriodicUploader, error) {
	logIncomingEventPath := path.Join(logEventPath, logevents.IncomingDir)
	logArchiveEventPath := path.Join(logEventPath, logevents.ArchiveDir)
	statusManager, err := NewStatusManager(logIncomingEventPath)
	if err != nil {
		return nil, err
	}
	return &PeriodicUploader{
		logIncomingEventPath: logIncomingEventPath,
		fileMask:             path.Join(logIncomingEventPath, fileMask),
		uploadEvery:          time.Duration(uploadEveryMin) * time.Minute,
		archiver:             NewArchiver(logIncomingEventPath, logArchiveEventPath),
		statusManager:        statusManager,
		destinationService:   destinationService,
	}, nil
}

// Start reading event logger log directory and finding already rotated and closed files by mask
// pass them to storages according to tokens
// keep uploading log statuses file for every event log file
func (u *PeriodicUploader) Start() {
	safego.RunWithRestart(func() {
		for {
			if appstatus.Instance.Idle.Load() {
				break
			}

			if destinations.StatusInstance.Reloading {
				time.Sleep(2 * time.Second)
				continue
			}
			startTime := timestamp.Now()
			postHandlesMap := make(map[string]map[string]bool) //multimap postHandleDestinationId:destinationIds
			files, err := filepath.Glob(u.fileMask)
			if err != nil {
				logging.SystemErrorf("Error finding files by %s mask: %v", u.fileMask, err)
				return
			}

			for _, filePath := range files {
				fileName := filepath.Base(filePath)

				regexResult := DateExtractRegexp.FindStringSubmatch(fileName)
				if len(regexResult) != 2 {
					logging.SystemErrorf("Error processing file %s. Malformed name", filePath)
					continue
				}
				fileDate, err := time.Parse("2006-01-02T15-04-05", regexResult[1])
				if err != nil {
					logging.SystemErrorf("Error processing file %s. Cant parse file date: %s", filePath, fileDate)
					continue
				}

				if timestamp.Now().Sub(fileDate) > time.Hour*24*30 {
					logging.Infof("Skipping file %s. File is more than 30 days old: %s", filePath, fileDate)
					continue
				}

				//get token from filename
				regexResult = logging.TokenIDExtractRegexp.FindStringSubmatch(fileName)
				if len(regexResult) != 2 {
					logging.SystemErrorf("Error processing file %s. Malformed name", filePath)
					continue
				}

				tokenID := regexResult[1]
				storageProxies := u.destinationService.GetBatchStorages(tokenID)
				if len(storageProxies) == 0 {
					logging.Warnf("Destination storages weren't found for file [%s] and token [%s]", filePath, tokenID)
					continue
				}

				fileBytes, err := ioutil.ReadFile(filePath)
				if err != nil {
					logging.SystemErrorf("Error reading file [%s] with events: %v", filePath, err)
					continue
				}
				if len(fileBytes) == 0 {
					os.Remove(filePath)
					continue
				}

				needCopyEvent := len(storageProxies) > 1

				objects, parsingErrors, err := parsers.ParseJSONFileWithFuncFallback(fileBytes, parsers.ParseJSON)
				if err != nil {
					logging.SystemErrorf("Error parsing JSON file [%s] with events: %v", filePath, err)
					continue
				}

				if len(parsingErrors) > 0 {
					if len(objects) == 0 {
						logging.SystemErrorf("JSON file [%s] contains only records with errors: [%d]. (for instance event [%s]: %vs)", filePath, len(parsingErrors), string(parsingErrors[0].Original), parsingErrors[0].Error)
						continue
					}

					logging.Warnf("JSON file %s contains %d malformed events. They are sent to failed log", filePath, len(parsingErrors))
				}

				//flag for archiving file if all storages don't have errors while storing this file
				archiveFile := true
				for _, storageProxy := range storageProxies {
					storage, ok := storageProxy.Get()
					if !ok {
						archiveFile = false
						continue
					}

					alreadyUploadedTables := map[string]bool{}
					tableStatuses := u.statusManager.GetTablesStatuses(fileName, storage.ID())
					for tableName, status := range tableStatuses {
						if status.Uploaded {
							alreadyUploadedTables[tableName] = true
						}
					}

					resultPerTable, failedEvents, skippedEvents, err := storage.Store(fileName, objects, alreadyUploadedTables, needCopyEvent)

					if !skippedEvents.IsEmpty() {
						metrics.SkipTokenEvents(tokenID, storage.Type(), storage.ID(), len(skippedEvents.Events))
						counters.SkipPushDestinationEvents(storage.ID(), int64(len(skippedEvents.Events)))
					}

					if err != nil {
						archiveFile = false
						logging.Errorf("[%s] Error storing file %s in destination: %v", storage.ID(), filePath, err)

						//extract src
						eventsSrc := map[string]int{}
						for _, obj := range objects {
							eventsSrc[events.ExtractSrc(obj)]++
						}

						errRowsCount := len(objects)
						metrics.ErrorTokenEvents(tokenID, storage.Type(), storage.ID(), errRowsCount)
						counters.ErrorPushDestinationEvents(storage.ID(), int64(errRowsCount))

						telemetry.PushedErrorsPerSrc(tokenID, storage.ID(), eventsSrc)

						continue
					}

					//** Fallback **
					//events that are failed to be parsed
					if len(parsingErrors) > 0 {
						var parsingFailedEvents []*events.FailedEvent
						for _, pe := range parsingErrors {
							parsingFailedEvents = append(parsingFailedEvents, &events.FailedEvent{
								MalformedEvent: string(pe.Original),
								Error:          pe.Error,
							})
						}
						storage.Fallback(parsingFailedEvents...)
						telemetry.PushedErrorsPerSrc(tokenID, storage.ID(), map[string]int{parsingErrSrc: len(parsingErrors)})
					}
					//events that are failed to be processed
					if !failedEvents.IsEmpty() {
						storage.Fallback(failedEvents.Events...)
						metrics.ErrorTokenEvents(tokenID, storage.Type(), storage.ID(), len(failedEvents.Events))
						counters.ErrorPushDestinationEvents(storage.ID(), int64(len(failedEvents.Events)))
						telemetry.PushedErrorsPerSrc(tokenID, storage.ID(), failedEvents.Src)
					}

					for tableName, result := range resultPerTable {
						if result.Err != nil {
							archiveFile = false
							logging.Errorf("[%s] Error storing table %s from file %s: %v", storage.ID(), tableName, filePath, result.Err)
							metrics.ErrorTokenEvents(tokenID, storage.Type(), storage.ID(), result.RowsCount)
							counters.ErrorPushDestinationEvents(storage.ID(), int64(result.RowsCount))

							telemetry.PushedErrorsPerSrc(tokenID, storage.ID(), result.EventsSrc)
						} else {
							pHandles := storageProxy.GetPostHandleDestinations()
							if pHandles != nil && result.RowsCount > 0 {
								for _, pHandle := range pHandles {
									mp, ok := postHandlesMap[pHandle]
									if !ok {
										mp = make(map[string]bool)
										postHandlesMap[pHandle] = mp
									}
									mp[storage.ID()] = true
								}
							}
							metrics.SuccessTokenEvents(tokenID, storage.Type(), storage.ID(), result.RowsCount)
							counters.SuccessPushDestinationEvents(storage.ID(), int64(result.RowsCount))

							telemetry.PushedEventsPerSrc(tokenID, storage.ID(), result.EventsSrc)
						}

						u.statusManager.UpdateStatus(fileName, storage.ID(), tableName, result.Err)
					}
				}

				if archiveFile {
					err := u.archiver.Archive(fileName)
					if err != nil {
						logging.SystemErrorf("Error archiving [%s] file: %v", filePath, err)
					} else {
						u.statusManager.CleanUp(fileName)
					}
				}
			}
			u.postHandle(startTime, timestamp.Now(), postHandlesMap)
			time.Sleep(u.uploadEvery - time.Since(startTime))

		}
	})
}

func (u *PeriodicUploader) postHandle(start, end time.Time, postHandlesMap map[string]map[string]bool) {
	for phID, destsMap := range postHandlesMap {
		dests := make([]string, 0, len(destsMap))
		for k := range destsMap {
			dests = append(dests, k)
		}
		event := events.Event{
			"event_type":  storages.DestinationBatchEventType,
			"source":      dests,
			timestamp.Key: end,
			"finished_at": end,
			"started_at":  start,
		}
		err := u.destinationService.PostHandle(phID, event)
		if err != nil {
			logging.Error(err)
		}
		logging.Infof("Successful run of %v triggered postHandle destination: %s", dests, phID)
	}

}
