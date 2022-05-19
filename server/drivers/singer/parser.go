package singer

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/singer"
	"io"
	"math"
)

const (
	SINGER_REPLICATION_INCREMENTAL = "INCREMENTAL"
	SINGER_REPLICATION_FULL_TABLE  = "FULL_TABLE"
)

//StreamOutputParser is an Singer output parser
type streamOutputParser struct {
	dataConsumer      base.CLIDataConsumer
	logger            logging.TaskLogger
	streamReplication map[string]string
}

type SchemaRecord struct {
	Type          string   `json:"type,omitempty"`
	Stream        string   `json:"stream,omitempty"`
	Schema        *Schema  `json:"schema,omitempty"`
	KeyProperties []string `json:"key_properties,omitempty"`
}

type Schema struct {
	Properties map[string]*base.Property `json:"properties,omitempty"`
}

//Parse reads from stdout and:
//  parses singer output
//  passes data as batches to dataConsumer
func (sop *streamOutputParser) Parse(stdout io.ReadCloser) error {
	sop.logger.INFO("Singer sync will store data as batches >= [%d] elements size", singer.Instance.BatchSize)

	outputPortion := base.NewCLIOutputRepresentation()

	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, math.MaxInt/2)

	records := 0
	streamCleaned := map[string]bool{}
	for scanner.Scan() {
		lineBytes := scanner.Bytes()

		lineObject := map[string]interface{}{}
		err := json.Unmarshal(lineBytes, &lineObject)
		if err != nil {
			return fmt.Errorf("Error unmarshalling singer output line %s into json: %v", string(lineBytes), err)
		}

		objectType, ok := lineObject["type"]
		if !ok || objectType == "" {
			return fmt.Errorf("Error getting singer object 'type' field from: %s", string(lineBytes))
		}

		switch objectType {
		case "SCHEMA":
			streamRepresentation, err := parseSchema(lineBytes)
			if err != nil {
				return fmt.Errorf("Error parsing singer schema %s: %v", string(lineBytes), err)
			}

			if cleaned, exists := streamCleaned[streamRepresentation.StreamName]; !exists || !cleaned {
				if isFullTableReplication(streamRepresentation.StreamName, sop.streamReplication) {
					streamRepresentation.NeedClean = true
					streamCleaned[streamRepresentation.StreamName] = false
				}
			} else {
				streamRepresentation.NeedClean = false
			}

			outputPortion.AddStream(streamRepresentation.StreamName, streamRepresentation)
		case "STATE":
			state, ok := lineObject["value"]
			if !ok {
				return fmt.Errorf("Error parsing singer state line %s: malformed state line 'value' doesn't exist", string(lineBytes))
			}

			outputPortion.State = state

		case "RECORD":
			records++
			streamName, object, err := parseRecord(lineObject)
			if err != nil {
				return fmt.Errorf("Error parsing singer record line %s: %v", string(lineBytes), err)
			}

			streamName = schema.Reformat(streamName)
			s, _ := outputPortion.GetStream(streamName)
			s.Objects = append(s.Objects, object)
		default:
			msg := fmt.Sprintf("Unknown Singer output line type: %s [%v]", objectType, lineObject)
			logging.Warnf(msg)
			sop.logger.WARN(msg)
		}

		//persist batch and recreate variables
		if records >= singer.Instance.BatchSize {
			err := sop.dataConsumer.Consume(outputPortion)
			if err != nil {
				return err
			}

			//remove already persisted objects
			//remember streams that has tables cleaned already.
			for _, stream := range outputPortion.GetStreams() {
				stream.Objects = []map[string]interface{}{}
				streamCleaned[stream.StreamName] = !stream.NeedClean
			}
			records = 0
		}
	}

	//persist last batch
	if records > 0 {
		err := sop.dataConsumer.Consume(outputPortion)
		if err != nil {
			return err
		}
	}

	err := scanner.Err()
	if err != nil {
		return err
	}

	return nil
}

func isFullTableReplication(stream string, streamReplication map[string]string) bool {
	if replication, exists := streamReplication[stream]; exists {
		return replication == SINGER_REPLICATION_FULL_TABLE
	}
	return false
}

func parseRecord(line map[string]interface{}) (string, map[string]interface{}, error) {
	streamName, ok := line["stream"]
	if !ok {
		return "", nil, errors.New("malformed record line 'stream' doesn't exist")
	}

	record, ok := line["record"]
	if !ok {
		return "", nil, errors.New("malformed record line 'record' doesn't exist")
	}

	object, ok := record.(map[string]interface{})
	if !ok {
		return "", nil, errors.New("malformed record line 'record' must be a json object")
	}

	return fmt.Sprint(streamName), object, nil
}

func parseSchema(schemaBytes []byte) (*base.StreamRepresentation, error) {
	sr := &SchemaRecord{}
	err := json.Unmarshal(schemaBytes, sr)
	if err != nil {
		return nil, fmt.Errorf("Error unmarshalling schema object: %v", err)
	}

	fields := schema.Fields{}
	base.ParseProperties(base.SingerType, "", sr.Schema.Properties, fields)

	streamName := schema.Reformat(sr.Stream)
	return &base.StreamRepresentation{
		StreamName:  streamName,
		BatchHeader: &schema.BatchHeader{TableName: streamName, Fields: fields},
		KeyFields:   sr.KeyProperties,
		NeedClean:   false,
	}, nil
}
