package logfiles

import (
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/telemetry"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"time"
)

//PeriodicUploader read already rotated and closed log files
//Pass them to storages according to tokens
//Keep uploading log file with result statuses
type PeriodicUploader struct {
	logIncomingEventPath string
	fileMask             string
	uploadEvery          time.Duration

	archiver           *Archiver
	statusManager      *StatusManager
	destinationService *destinations.Service
}

//NewUploader returns new configured PeriodicUploader instance
func NewUploader(logEventPath, fileMask string, uploadEveryS int, destinationService *destinations.Service) (*PeriodicUploader, error) {
	logIncomingEventPath := path.Join(logEventPath, logging.IncomingDir)
	logArchiveEventPath := path.Join(logEventPath, logging.ArchiveDir)
	statusManager, err := NewStatusManager(logIncomingEventPath)
	if err != nil {
		return nil, err
	}
	return &PeriodicUploader{
		logIncomingEventPath: logIncomingEventPath,
		fileMask:             path.Join(logIncomingEventPath, fileMask),
		uploadEvery:          time.Duration(uploadEveryS) * time.Second,
		archiver:             NewArchiver(logIncomingEventPath, logArchiveEventPath),
		statusManager:        statusManager,
		destinationService:   destinationService,
	}, nil
}

//Start reading event logger log directory and finding already rotated and closed files by mask
//pass them to storages according to tokens
//keep uploading log statuses file for every event log file
func (u *PeriodicUploader) Start() {
	safego.RunWithRestart(func() {
		for {
			if appstatus.Instance.Idle {
				break
			}

			if destinations.StatusInstance.Reloading {
				time.Sleep(2 * time.Second)
				continue
			}

			files, err := filepath.Glob(u.fileMask)
			if err != nil {
				logging.SystemErrorf("Error finding files by %s mask: %v", u.fileMask, err)
				return
			}

			for _, filePath := range files {
				fileName := filepath.Base(filePath)

				b, err := ioutil.ReadFile(filePath)
				if err != nil {
					logging.SystemErrorf("Error reading file [%s] with events: %v", filePath, err)
					continue
				}
				if len(b) == 0 {
					os.Remove(filePath)
					continue
				}
				//get token from filename
				regexResult := logging.TokenIDExtractRegexp.FindStringSubmatch(fileName)
				if len(regexResult) != 2 {
					logging.SystemErrorf("Error processing file %s. Malformed name", filePath)
					continue
				}

				tokenID := regexResult[1]
				storageProxies := u.destinationService.GetStorages(tokenID)
				if len(storageProxies) == 0 {
					logging.Warnf("Destination storages weren't found for file [%s] and token [%s]", filePath, tokenID)
					continue
				}

				objects, err := parsers.ParseJSONFile(b)
				if err != nil {
					logging.SystemErrorf("Error parsing JSON file [%s] with events: %v", filePath, err)
					continue
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
					tableStatuses := u.statusManager.GetTablesStatuses(fileName, storage.Name())
					for tableName, status := range tableStatuses {
						if status.Uploaded {
							alreadyUploadedTables[tableName] = true
						}
					}

					resultPerTable, failedEvents, err := storage.Store(fileName, objects, alreadyUploadedTables)

					if err != nil {
						archiveFile = false
						logging.Errorf("[%s] Error storing file %s in destination: %v", storage.Name(), filePath, err)

						//extract src
						eventsSrc := map[string]int{}
						for _, obj := range objects {
							eventsSrc[events.ExtractSrc(obj)]++
						}

						errRowsCount := len(objects)
						metrics.ErrorTokenEvents(tokenID, storage.Name(), errRowsCount)
						counters.ErrorEvents(storage.Name(), errRowsCount)

						telemetry.ErrorsPerSrc(tokenID, storage.Name(), eventsSrc)

						continue
					}

					//events which are failed to process
					if failedEvents != nil {
						storage.Fallback(failedEvents.Events...)

						telemetry.ErrorsPerSrc(tokenID, storage.Name(), failedEvents.Src)
					}

					for tableName, result := range resultPerTable {
						if result.Err != nil {
							archiveFile = false
							logging.Errorf("[%s] Error storing table %s from file %s: %v", storage.Name(), tableName, filePath, result.Err)
							metrics.ErrorTokenEvents(tokenID, storage.Name(), result.RowsCount)
							counters.ErrorEvents(storage.Name(), result.RowsCount)

							telemetry.ErrorsPerSrc(tokenID, storage.Name(), result.EventsSrc)
						} else {
							metrics.SuccessTokenEvents(tokenID, storage.Name(), result.RowsCount)
							counters.SuccessEvents(storage.Name(), result.RowsCount)

							telemetry.EventsPerSrc(tokenID, storage.Name(), result.EventsSrc)
						}

						u.statusManager.UpdateStatus(fileName, storage.Name(), tableName, result.Err)
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

			time.Sleep(u.uploadEvery)
		}
	})
}
