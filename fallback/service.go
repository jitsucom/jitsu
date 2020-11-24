package fallback

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/logfiles"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sync"
)

const fallbackFileMaskPostfix = "-errors-*-20*.log"

var destinationIdExtractRegexp = regexp.MustCompile("-errors-(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

type Service struct {
	fallbackDir        string
	fileMask           string
	statusManager      *logfiles.StatusManager
	destinationService *destinations.Service

	locks sync.Map
}

//only for tests
func NewTestService() *Service {
	return &Service{}
}

func NewService(fallbackLogsPath string, destinationService *destinations.Service) (*Service, error) {
	statusManager, err := logfiles.NewStatusManager(fallbackLogsPath)
	if err != nil {
		return nil, fmt.Errorf("Error creating fallback files status manager: %v", err)
	}
	return &Service{
		fallbackDir:        fallbackLogsPath,
		statusManager:      statusManager,
		fileMask:           path.Join(fallbackLogsPath, appconfig.Instance.ServerName+fallbackFileMaskPostfix),
		destinationService: destinationService,
	}, nil
}

func (s *Service) Replay(fileName string) error {
	if fileName == "" {
		return errors.New("File name can't be empty")
	}
	_, loaded := s.locks.LoadOrStore(fileName, true)
	if loaded {
		return fmt.Errorf("File [%s] is being processed", fileName)
	}
	defer s.locks.Delete(fileName)

	filePath := path.Join(s.fallbackDir, fileName)
	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("Error reading fallback file [%s]: %v", fileName, err)
	}

	//get destinationId from filename
	regexResult := destinationIdExtractRegexp.FindStringSubmatch(fileName)
	if len(regexResult) != 2 {
		return fmt.Errorf("Error processing fallback file %s. Malformed name", fileName)
	}

	destinationId := regexResult[1]

	status, ok := s.statusManager.Get(fileName, destinationId)
	if ok && status.Uploaded {
		return fmt.Errorf("File [%s] has already been uploaded", fileName)
	}

	storageProxy, ok := s.destinationService.GetStorageById(destinationId)
	if !ok {
		return fmt.Errorf("Destination [%s] wasn't found", destinationId)
	}

	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("Destination [%s] hasn't been initialized yet", destinationId)
	}

	_, err = storage.StoreWithParseFunc(fileName, b, parsers.ParseFallbackJson)
	s.statusManager.UpdateStatus(fileName, storage.Name(), err)

	if err != nil {
		return fmt.Errorf("[%s] Error storing fallback file %s in destination: %v", storage.Name(), fileName, err)
	}

	err = os.Remove(filePath)
	if err != nil {
		logging.Error("Error deleting fallback file", filePath, err)
	} else {
		s.statusManager.CleanUp(fileName)
	}

	return nil
}

func (s *Service) GetFileStatuses(destinationsFilter map[string]bool) []*FileStatus {
	files, err := filepath.Glob(s.fileMask)
	if err != nil {
		logging.Errorf("Error finding fallback files by mask [%s]: %v", s.fileMask, err)
		return []*FileStatus{}
	}

	fileStatuses := []*FileStatus{}

	for _, filePath := range files {
		fileName := filepath.Base(filePath)

		b, err := ioutil.ReadFile(filePath)
		if err != nil {
			logging.Errorf("Error reading fallback file [%s]: %v", filePath, err)
			continue
		}
		if len(b) == 0 {
			os.Remove(filePath)
			s.statusManager.CleanUp(fileName)
			continue
		}

		//get destinationId from filename
		regexResult := destinationIdExtractRegexp.FindStringSubmatch(fileName)
		if len(regexResult) != 2 {
			logging.Errorf("Error processing fallback file %s. Malformed name", filePath)
			continue
		}

		destinationId := regexResult[1]
		_, ok := destinationsFilter[destinationId]
		if len(destinationsFilter) > 0 && !ok {
			continue
		}

		status, ok := s.statusManager.Get(fileName, destinationId)
		if !ok {
			status = &logfiles.Status{}
		}

		fileStatuses = append(fileStatuses, &FileStatus{
			FileName:      fileName,
			DestinationId: destinationId,
			Uploaded:      status.Uploaded,
			Error:         status.Err,
		})

	}

	return fileStatuses
}
