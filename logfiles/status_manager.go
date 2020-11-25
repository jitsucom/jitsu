package logfiles

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/logging"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
)

const statusFileExtension = ".status"
const statusFileMask = "*" + statusFileExtension

type Status struct {
	Uploaded bool   `json:"uploaded"`
	Err      string `json:"error"`
}

type StatusManager struct {
	sync.RWMutex

	filesPath string
	fileMask  string
	//fileLogName: {"storage1": Status, "storage2": Status}
	fileStatuses map[string]map[string]*Status
}

func NewStatusManager(logEventPath string) (*StatusManager, error) {
	fileMask := path.Join(logEventPath, statusFileMask)
	files, err := filepath.Glob(fileMask)
	if err != nil {
		return nil, err
	}

	fileStatuses := map[string]map[string]*Status{}
	for _, filePath := range files {
		fileStatusName := filepath.Base(filePath)
		fileLogName := strings.Split(fileStatusName, statusFileExtension)[0]

		b, err := ioutil.ReadFile(filePath)
		if err != nil {
			logging.Error("Error reading log status file", filePath, err)
			continue
		}
		if len(b) == 0 {
			fileStatuses[fileLogName] = map[string]*Status{}
			continue
		}
		statuses := map[string]*Status{}
		if err := json.Unmarshal(b, &statuses); err != nil {
			logging.Error("Error unmarshalling log status file", filePath, err)
			fileStatuses[fileLogName] = map[string]*Status{}
			continue
		}
		fileStatuses[fileLogName] = statuses
	}

	return &StatusManager{
		filesPath:    logEventPath,
		fileMask:     fileMask,
		fileStatuses: fileStatuses,
	}, nil
}

func (sm *StatusManager) IsUploaded(fileName, storage string) bool {
	sm.RLock()
	defer sm.RUnlock()

	statuses, ok := sm.fileStatuses[fileName]
	if !ok {
		return false
	}

	status, ok := statuses[storage]
	if !ok {
		return false
	}

	return status.Uploaded
}

func (sm *StatusManager) Get(fileName, storage string) (*Status, bool) {
	sm.RLock()
	defer sm.RUnlock()

	statuses, ok := sm.fileStatuses[fileName]
	if !ok {
		return nil, false
	}

	status, ok := statuses[storage]
	if !ok {
		return nil, false
	}

	return status, true
}

func (sm *StatusManager) UpdateStatus(fileName, storage string, storageErr error) {
	sm.Lock()
	defer sm.Unlock()

	statusesPerStorage, ok := sm.fileStatuses[fileName]
	if !ok {
		statusesPerStorage = map[string]*Status{}
		sm.fileStatuses[fileName] = statusesPerStorage
	}

	status, ok := statusesPerStorage[storage]
	if !ok {
		status = &Status{}
		statusesPerStorage[storage] = status
	}

	if storageErr == nil {
		status.Uploaded = true
		status.Err = ""
	} else {
		status.Uploaded = false
		status.Err = storageErr.Error()
	}

	sm.persist(fileName, statusesPerStorage)
}

func (sm *StatusManager) persist(fileName string, statusesPerStorage map[string]*Status) {
	b, err := json.Marshal(statusesPerStorage)
	if err != nil {
		logging.Error("Error marshaling event log file statuses for file", fileName, err)
		return
	}
	filePath := path.Join(sm.filesPath, fileName+statusFileExtension)
	if err := ioutil.WriteFile(filePath, b, 0644); err != nil {
		logging.Error("Error writing event log status file", filePath, err)
	}
}

func (sm *StatusManager) CleanUp(fileName string) {
	sm.Lock()
	defer sm.Unlock()

	delete(sm.fileStatuses, fileName)

	os.Remove(path.Join(sm.filesPath, fileName+statusFileExtension))
}
