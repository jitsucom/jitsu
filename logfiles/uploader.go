package logfiles

import (
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"io/ioutil"
	"log"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"time"
)

//regex for reading already rotated and closed log files
var tokenExtractRegexp = regexp.MustCompile("-event-(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

type Uploader interface {
	Start()
}

//PeriodicUploader read already rotated and closed log files
//Pass them to storages according to tokens
//Keep uploading log file with result statuses
type PeriodicUploader struct {
	logEventPath   string
	fileMask       string
	filesBatchSize int
	uploadEvery    time.Duration

	statusManager          *statusManager
	tokenizedEventStorages map[string][]events.Storage
}

type DummyUploader struct{}

func (*DummyUploader) Start() {
}

func NewUploader(logEventPath, fileMask string, filesBatchSize, uploadEveryS int, tokenizedEventStorages map[string][]events.Storage) (Uploader, error) {
	if len(tokenizedEventStorages) == 0 {
		return &DummyUploader{}, nil
	}

	statusManager, err := newStatusManager(logEventPath)
	if err != nil {
		return nil, err
	}
	return &PeriodicUploader{
		logEventPath:           logEventPath,
		fileMask:               path.Join(logEventPath, fileMask),
		filesBatchSize:         filesBatchSize,
		uploadEvery:            time.Duration(uploadEveryS) * time.Second,
		statusManager:          statusManager,
		tokenizedEventStorages: tokenizedEventStorages,
	}, nil
}

//Start reading event logger log directory and finding already rotated and closed files by mask
//pass them to storages according to tokens
//keep uploading log statuses file for every event log file
func (u *PeriodicUploader) Start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			files, err := filepath.Glob(u.fileMask)
			if err != nil {
				log.Println("Error finding files by mask", u.fileMask, err)
				return
			}

			sort.Strings(files)
			batchSize := len(files)
			if batchSize > u.filesBatchSize {
				batchSize = u.filesBatchSize
			}
			for _, filePath := range files[:batchSize] {
				fileName := filepath.Base(filePath)

				b, err := ioutil.ReadFile(filePath)
				if err != nil {
					log.Println("Error reading file", filePath, err)
					continue
				}
				if len(b) == 0 {
					os.Remove(filePath)
					continue
				}
				//get token from filename
				regexResult := tokenExtractRegexp.FindStringSubmatch(fileName)
				if len(regexResult) != 2 {
					log.Printf("Error processing file %s. Malformed name", filePath)
					continue
				}

				token := regexResult[1]
				eventStorages, ok := u.tokenizedEventStorages[token]
				if !ok {
					log.Printf("Destination storages weren't found for token %s", token)
					continue
				}

				//flag for deleting file if all storages don't have errors while storing this file
				deleteFile := true
				for _, storage := range eventStorages {
					if !u.statusManager.isUploaded(fileName, storage.Name()) {
						err := storage.Store(fileName, b)
						if err != nil {
							deleteFile = false
							log.Println("Error store file", filePath, "in", storage.Name(), "destination:", err)
						}
						u.statusManager.updateStatus(fileName, storage.Name(), err)
					}
				}

				if deleteFile {
					err := os.Remove(filePath)
					if err != nil {
						log.Println("Error deleting file", filePath, err)
					} else {
						u.statusManager.cleanUp(fileName)
					}
				}
			}

			time.Sleep(u.uploadEvery)
		}
	}()
}
