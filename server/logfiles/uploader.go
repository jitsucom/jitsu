package logfiles

import (
	"fmt"
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
	errorRetryPeriod     int

	archiver           *Archiver
	retirer            *Archiver
	statusManager      *StatusManager
	destinationService *destinations.Service
}

// NewUploader returns new configured PeriodicUploader instance
func NewUploader(logEventPath, fileMask string, uploadEveryMin, errorRetryPeriod int, destinationService *destinations.Service) (*PeriodicUploader, error) {
	logArchiveEventPath := path.Join(logEventPath, logevents.ArchiveDir)
	logIncomingEventPath := path.Join(logEventPath, logevents.IncomingDir)
	logRetiredEventPath := path.Join(logEventPath, logevents.RetiredDir)
	statusManager, err := NewStatusManager(logIncomingEventPath)
	if err != nil {
		return nil, err
	}
	return &PeriodicUploader{
		logIncomingEventPath: logIncomingEventPath,
		fileMask:             path.Join(logIncomingEventPath, fileMask),
		uploadEvery:          time.Duration(uploadEveryMin) * time.Minute,
		errorRetryPeriod:     errorRetryPeriod,
		archiver:             NewArchiver(logIncomingEventPath, logArchiveEventPath),
		retirer:              NewArchiver(logIncomingEventPath, logRetiredEventPath),
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

				fileDate, err := parseFileTime(fileName)
				if err != nil {
					logging.SystemErrorf("Error processing file [%s]: %v", fileName, err)
					continue
				}

				if timestamp.Now().Sub(fileDate) > time.Hour*24*30 {
					logging.Infof("Skipping file %s. File is more than 30 days old: %s", filePath, fileDate)
					continue
				}

				//get token from filename
				tokenID, err := parseFileToken(fileName)
				if err != nil {
					logging.SystemErrorf("Error processing file [%s]: %v", fileName, err)
					continue
				}

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
						u.skipEvent(tokenID, storage.Type(), storage.ID(), len(skippedEvents.Events))
					}

					if err != nil {
						archiveFile = false
						logging.Errorf("[%s] Error storing file %s in destination: %v", storage.ID(), filePath, err)

						//extract src
						eventsSrc := map[string]int{}
						for _, obj := range objects {
							eventsSrc[events.ExtractSrc(obj)]++
						}

						u.errorEvent(tokenID, storage.Type(), storage.ID(), len(objects), eventsSrc)
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
						u.errorEvent(tokenID, storage.Type(), storage.ID(), len(parsingErrors), map[string]int{parsingErrSrc: len(parsingErrors)})
					}
					//events that are failed to be processed
					if !failedEvents.IsEmpty() {
						storage.Fallback(failedEvents.Events...)
						u.errorEvent(tokenID, storage.Type(), storage.ID(), len(failedEvents.Events), failedEvents.Src)
					}

					for tableName, result := range resultPerTable {
						if result.Err != nil {
							archiveFile = false
							logging.Errorf("[%s] Error storing table %s from file %s: %v", storage.ID(), tableName, filePath, result.Err)
							u.errorEvent(tokenID, storage.Type(), storage.ID(), result.RowsCount, result.EventsSrc)
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

							u.successEvent(tokenID, storage.Type(), storage.ID(), result.RowsCount, result.EventsSrc)
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
				} else {
					// If file exist more than errorRetryPeriod hours it should be retired
					if timestamp.Now().Sub(fileDate) > time.Duration(u.errorRetryPeriod)*time.Hour {
						logging.Infof("Retired file [%s]. File is more than %d hours old: %s", filePath, u.errorRetryPeriod, fileDate)
						err := u.retirer.Archive(fileName)
						if err != nil {
							logging.SystemErrorf("Error retiring [%s] file: %v", filePath, err)
						} else {
							u.statusManager.CleanUp(fileName)
						}
					}
				}
			}

			u.postHandle(startTime, timestamp.Now(), postHandlesMap)
			time.Sleep(u.uploadEvery - time.Since(startTime))
		}
	})
}

// errorEvent writes metrics/counters/events
func (u *PeriodicUploader) errorEvent(tokenID, storageType, storageID string, errorsCount int, result map[string]int) {
	metrics.ErrorTokenEvents(tokenID, storageType, storageID, errorsCount)
	counters.ErrorPushDestinationEvents(storageID, int64(errorsCount))
	telemetry.PushedErrorsPerSrc(tokenID, storageID, result)
}

// skipEvent writes metrics/counters/events
func (u *PeriodicUploader) skipEvent(tokenID, storageType, storageID string, skipCount int) {
	metrics.SkipTokenEvents(tokenID, storageType, storageID, skipCount)
	counters.SkipPushDestinationEvents(storageID, int64(skipCount))
}

// successEvent writes metrics/counters/events
func (u *PeriodicUploader) successEvent(tokenID, storageType, storageID string, rowsCount int, result map[string]int) {
	metrics.SuccessTokenEvents(tokenID, storageType, storageID, rowsCount)
	counters.SuccessPushDestinationEvents(storageID, int64(rowsCount))
	telemetry.PushedEventsPerSrc(tokenID, storageID, result)
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

func parseFileTime(fileName string) (time.Time, error) {
	regexResult := DateExtractRegexp.FindStringSubmatch(fileName)
	if len(regexResult) != 2 {
		return time.Time{}, fmt.Errorf("Malformed name")
	}

	fileDate, err := time.Parse("2006-01-02T15-04-05", regexResult[1])
	if err != nil {
		return time.Time{}, fmt.Errorf("Cannot parse file date: %s", regexResult[1])
	}

	return fileDate, nil
}

func parseFileToken(fileName string) (string, error) {
	regexResult := logging.TokenIDExtractRegexp.FindStringSubmatch(fileName)
	if len(regexResult) != 2 {
		return "", fmt.Errorf("Malformed name")
	}

	token := regexResult[1]
	return token, nil
}
