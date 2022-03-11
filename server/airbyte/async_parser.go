package airbyte

import (
	"bufio"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"io"
	"math"
)

const (
	airbyteSystem = "Airbyte"
)

//asynchronousParser is an Airbyte read command result parser
type asynchronousParser struct {
	dataConsumer          base.CLIDataConsumer
	streamsRepresentation map[string]*base.StreamRepresentation
	logger                logging.TaskLogger
}

//Parse reads from stdout and:
//  parses airbyte output
//  applies input schemas
//  passes data as batches to dataConsumer
func (ap *asynchronousParser) parse(stdout io.Reader) error {
	ap.logger.INFO("Airbyte sync will store data as batches >= [%d] elements size", Instance.batchSize)

	output := &base.CLIOutputRepresentation{
		Streams: map[string]*base.StreamRepresentation{},
	}

	for streamName, representation := range ap.streamsRepresentation {
		output.Streams[streamName] = &base.StreamRepresentation{
			BatchHeader: &schema.BatchHeader{TableName: representation.BatchHeader.TableName, Fields: representation.BatchHeader.Fields.Clone()},
			KeyFields:   representation.KeyFields,
			Objects:     []map[string]interface{}{},
			NeedClean:   representation.NeedClean,
		}
	}

	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, math.MaxInt/2)

	records := 0
	for scanner.Scan() {
		lineBytes := scanner.Bytes()

		row := &Row{}
		err := json.Unmarshal(lineBytes, row)
		if err != nil {
			ap.logger.LOG(string(lineBytes), airbyteSystem, logging.DEBUG)
			continue
		}

		if row.Type != RecordType || row.Record == nil {
			ap.logger.LOG(string(lineBytes), airbyteSystem, logging.DEBUG)
			continue
		}

		switch row.Type {
		case LogType:
			if row.Log == nil {
				return fmt.Errorf("Error parsing airbyte log line %s: 'log' doesn't exist", string(lineBytes))
			}
			switch row.Log.Level {
			case "ERROR":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.ERROR)
			case "INFO":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.INFO)
			case "WARN":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.WARN)
			default:
				logging.SystemErrorf("Unknown airbyte log message level: %s", row.Log.Level)
			}
		case StateType:
			if row.State == nil || row.State.Data == nil {
				return fmt.Errorf("Error parsing airbyte state line %s: malformed state line 'data' doesn't exist", string(lineBytes))
			}

			output.State = row.State.Data
		case RecordType:
			records++
			if row.Record == nil || row.Record.Data == nil {
				return fmt.Errorf("Error parsing airbyte record line %s: %v", string(lineBytes), err)
			}

			output.Streams[row.Record.Stream].Objects = append(output.Streams[row.Record.Stream].Objects, row.Record.Data)
		default:
			msg := fmt.Sprintf("Unknown airbyte output line type: %s [%s]", row.Type, string(lineBytes))
			logging.Error(msg)
			ap.logger.ERROR(msg)
		}

		//persist batch and recreate variables
		if records >= Instance.batchSize {
			err := ap.dataConsumer.Consume(output)
			if err != nil {
				return err
			}

			//remove already persisted objects
			for _, stream := range output.Streams {
				stream.Objects = []map[string]interface{}{}
			}
			records = 0
		}
	}

	//persist last batch
	if records > 0 {
		err := ap.dataConsumer.Consume(output)
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
