package logfiles

import (
	"github.com/jitsucom/eventnative/appstatus"
	"github.com/jitsucom/eventnative/counters"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/safego"
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
				regexResult := logging.TokenIdExtractRegexp.FindStringSubmatch(fileName)
				if len(regexResult) != 2 {
					logging.SystemErrorf("Error processing file %s. Malformed name", filePath)
					continue
				}

				tokenId := regexResult[1]
				storageProxies := u.destinationService.GetStorages(tokenId)
				if len(storageProxies) == 0 {
					logging.Warnf("Destination storages weren't found for file [%s] and token [%s]", filePath, tokenId)
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

					resultPerTable, errRowsCount, err := storage.Store(fileName, b, alreadyUploadedTables)
					if errRowsCount > 0 {
						metrics.ErrorTokenEvents(tokenId, storage.Name(), errRowsCount)
						counters.ErrorEvents(storage.Name(), errRowsCount)
					}

					if err != nil {
						archiveFile = false
						logging.Errorf("[%s] Error storing file %s in destination: %v", storage.Name(), filePath, err)
						continue
					}

					for tableName, result := range resultPerTable {
						if result.Err != nil {
							archiveFile = false
							logging.Errorf("[%s] Error storing table %s from file %s: %v", storage.Name(), tableName, filePath, result.Err)
							metrics.ErrorTokenEvents(tokenId, storage.Name(), result.RowsCount)
							counters.ErrorEvents(storage.Name(), result.RowsCount)
						} else {
							metrics.SuccessTokenEvents(tokenId, storage.Name(), result.RowsCount)
							counters.SuccessEvents(storage.Name(), result.RowsCount)
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
