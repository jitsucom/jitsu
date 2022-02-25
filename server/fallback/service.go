package fallback

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/logfiles"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"io/ioutil"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

const (
	fallbackFileMaskPostfix = "failed.dst=*-20*.log"
	fallbackIdentifier      = "fallback"
)

var destinationIDExtractRegexp = regexp.MustCompile("failed.dst=(.*)-\\d\\d\\d\\d-\\d\\d-\\d\\dT")

//Service stores and processes fallback files
type Service struct {
	fallbackDir        string
	fileMask           string
	statusManager      *logfiles.StatusManager
	destinationService *destinations.Service
	usersRecognition   events.Recognition
	archiver           *logfiles.Archiver

	locks sync.Map
}

//NewTestService returns test instance - only for tests
func NewTestService() *Service {
	return &Service{}
}

//NewService returns configured Service
func NewService(logEventsPath string, destinationService *destinations.Service, usersRecognition events.Recognition) (*Service, error) {
	fallbackPath := path.Join(logEventsPath, logevents.FailedDir)
	logArchiveEventPath := path.Join(logEventsPath, logevents.ArchiveDir)
	statusManager, err := logfiles.NewStatusManager(fallbackPath)
	if err != nil {
		return nil, fmt.Errorf("Error creating fallback files status manager: %v", err)
	}
	return &Service{
		fallbackDir:        fallbackPath,
		statusManager:      statusManager,
		fileMask:           path.Join(fallbackPath, fallbackFileMaskPostfix),
		destinationService: destinationService,
		usersRecognition:   usersRecognition,
		archiver:           logfiles.NewArchiver(fallbackPath, logArchiveEventPath),
	}, nil
}

//Replay processes fallback file (or plain file) and store it in the destination
func (s *Service) Replay(fileName, destinationID string, rawFile, skipMalformed bool) error {
	if fileName == "" {
		return errors.New("File name can't be empty")
	}

	//handle absolute and local path
	var filePath string
	if strings.HasPrefix(fileName, "/") {
		filePath = fileName
		fileName = filepath.Base(fileName)
	} else {
		filePath = path.Join(s.fallbackDir, fileName)
	}

	_, loaded := s.locks.LoadOrStore(fileName, true)
	if loaded {
		return fmt.Errorf("File [%s] is being processed", fileName)
	}
	defer s.locks.Delete(fileName)

	b, err := s.readFileBytes(filePath)
	if err != nil {
		return err
	}

	if destinationID == "" {
		//get destinationID from filename
		regexResult := destinationIDExtractRegexp.FindStringSubmatch(fileName)
		if len(regexResult) != 2 {
			return fmt.Errorf("Malformed file name: %s. Please provide destination_id or fileName must be a fallback file name with destination_id", fileName)
		}

		destinationID = regexResult[1]
	}

	storageProxy, ok := s.destinationService.GetDestinationByID(destinationID)
	if !ok {
		return fmt.Errorf("Destination [%s] wasn't found", destinationID)
	}

	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("Destination [%s] hasn't been initialized yet", destinationID)
	}
	if storage.IsStaging() {
		return fmt.Errorf("Error running fallback for destination [%s] in staged mode, "+
			"cannot be used to store data (only available for dry-run)", destinationID)
	}

	eventsConsumer, ok := s.destinationService.GetEventsConsumerByDestinationID(destinationID)
	if !ok {
		errMsg := fmt.Sprintf("Unable to find events consumer by destinationID: %s", destinationID)
		logging.SystemError(errMsg)
		return errors.New(errMsg)
	}

	objects, err := ExtractEvents(b, rawFile, skipMalformed)
	if err != nil {
		return fmt.Errorf("Error parsing fallback file %s: %v", fileName, err)
	}

	for _, object := range objects {
		var tokenID string
		apiTokenKey, ok := object[enrichment.ApiTokenKey]
		if ok {
			tokenID = appconfig.Instance.AuthorizationService.GetTokenID(fmt.Sprint(apiTokenKey))
		}

		eventID := storage.GetUniqueIDField().Extract(object)
		if eventID == "" {
			b, _ := json.MarshalIndent(object, "", "  ")
			logging.SystemErrorf("[%s] Empty extracted unique identifier in fallback event: %s", storage.GetUniqueIDField().GetFieldName(), string(b))
		}

		eventsConsumer.Consume(object, tokenID)
		s.usersRecognition.Event(object, eventID, []string{destinationID}, tokenID)
	}

	return nil
}

//GetFileStatuses returns all fallback files with their statuses
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

		//get destinationID from filename
		regexResult := destinationIDExtractRegexp.FindStringSubmatch(fileName)
		if len(regexResult) != 2 {
			logging.Errorf("Error processing fallback file %s. Malformed name", filePath)
			continue
		}

		destinationID := regexResult[1]
		_, ok := destinationsFilter[destinationID]
		if len(destinationsFilter) > 0 && !ok {
			continue
		}

		statuses := s.statusManager.GetTablesStatuses(fileName, destinationID)

		fileStatuses = append(fileStatuses, &FileStatus{
			FileName:      fileName,
			DestinationID: destinationID,
			TablesStatus:  statuses,
		})

	}

	return fileStatuses
}

//readFileBytes reads file from the file system and returns byte payload or err if occurred
//does unzip if file has been compressed
func (s *Service) readFileBytes(filePath string) ([]byte, error) {
	b, err := ioutil.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("Error reading file [%s] for replay: %v", filePath, err)
	}

	if !strings.HasSuffix(filePath, ".gz") {
		return b, nil
	}

	reader, err := gzip.NewReader(bytes.NewBuffer(b))
	if err != nil {
		return nil, err
	}

	var resB bytes.Buffer
	_, err = resB.ReadFrom(reader)
	if err != nil {
		return nil, err
	}

	return resB.Bytes(), nil
}

//ExtractEvents parses input bytes as plain jsons or fallback jsons or fallback jsons with skipping malformed objects
func ExtractEvents(b []byte, rawFile, skipMalformed bool) ([]map[string]interface{}, error) {
	var objects []map[string]interface{}
	var err error

	var parseErrors []parsers.ParseError
	if rawFile {
		objects, err = parsers.ParseJSONFileWithFunc(b, parsers.ParseJSON)
	} else {
		if skipMalformed {
			//ignore parsing errors
			objects, parseErrors, err = parsers.ParseJSONFileWithFuncFallback(b, events.ParseFallbackJSON)
		} else {
			objects, err = parsers.ParseJSONFileWithFunc(b, events.ParseFallbackJSON)
		}
	}
	if err != nil {
		return nil, err
	}

	for _, pe := range parseErrors {
		logging.Errorf("Event will be skipped because skip_malformed is provided: %s", pe.Error)
	}

	return objects, nil
}
