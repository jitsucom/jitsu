package logfiles

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/logging"
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

	filesDir        string
	statusFilesMask string
	//map[fileLogName]map[storageName]map[tableName]Status
	//incoming.tok=123 {"storage1":{tableName1": Status, "tableName2": Status}, "storage2":{tableName3": Status}}
	fileStorageTableStatuses map[string]map[string]map[string]*Status
}

func NewStatusManager(logFilesDir string) (*StatusManager, error) {
	statusFilesMask := path.Join(logFilesDir, statusFileMask)
	files, err := filepath.Glob(statusFilesMask)
	if err != nil {
		return nil, err
	}

	fileStorageTableStatuses := map[string]map[string]map[string]*Status{}
	for _, filePath := range files {
		fileStatusName := filepath.Base(filePath)
		fileLogName := strings.Split(fileStatusName, statusFileExtension)[0]

		b, err := ioutil.ReadFile(filePath)
		if err != nil {
			logging.Error("Error reading log status file", filePath, err)
			continue
		}

		if len(b) == 0 {
			fileStorageTableStatuses[fileLogName] = map[string]map[string]*Status{}
			continue
		}

		storageTableStatuses := map[string]map[string]*Status{}
		if err := json.Unmarshal(b, &storageTableStatuses); err != nil {
			logging.SystemError("Error unmarshalling log status file", filePath, err)
			fileStorageTableStatuses[fileLogName] = map[string]map[string]*Status{}
			continue
		}
		fileStorageTableStatuses[fileLogName] = storageTableStatuses
	}

	return &StatusManager{
		filesDir:                 logFilesDir,
		statusFilesMask:          statusFilesMask,
		fileStorageTableStatuses: fileStorageTableStatuses,
	}, nil
}

func (sm *StatusManager) GetTablesStatuses(fileName, storageName string) map[string]*Status {
	sm.RLock()
	defer sm.RUnlock()

	statuses, ok := sm.fileStorageTableStatuses[fileName][storageName]
	if !ok {
		return map[string]*Status{}
	}

	return statuses
}

func (sm *StatusManager) UpdateStatus(fileName, storage, table string, err error) {
	sm.Lock()
	defer sm.Unlock()

	statusesPerStorage, ok := sm.fileStorageTableStatuses[fileName]
	if !ok {
		statusesPerStorage = map[string]map[string]*Status{}
		sm.fileStorageTableStatuses[fileName] = statusesPerStorage
	}

	statusPerTable, ok := statusesPerStorage[storage]
	if !ok {
		statusPerTable = map[string]*Status{}
		sm.fileStorageTableStatuses[fileName][storage] = statusPerTable
	}

	var errMsg string
	if err != nil {
		errMsg = err.Error()
	}

	statusPerTable[table] = &Status{
		Uploaded: err == nil,
		Err:      errMsg,
	}

	sm.persist(fileName, statusesPerStorage)
}

func (sm *StatusManager) CleanUp(fileName string) {
	sm.Lock()
	defer sm.Unlock()

	delete(sm.fileStorageTableStatuses, fileName)

	os.Remove(path.Join(sm.filesDir, fileName+statusFileExtension))
}

func (sm *StatusManager) persist(fileName string, statuses map[string]map[string]*Status) {
	b, err := json.Marshal(statuses)
	if err != nil {
		logging.SystemErrorf("Error marshaling event log file statuses for [%s] file: %v", fileName, err)
		return
	}

	filePath := path.Join(sm.filesDir, fileName+statusFileExtension)
	if err := ioutil.WriteFile(filePath, b, 0644); err != nil {
		logging.SystemErrorf("Error writing event log status file [%s]: %v", filePath, err)
	}
}
