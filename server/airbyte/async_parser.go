package airbyte

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"io"
	"math"
	"time"
)

const (
	airbyteSystem = "Airbyte"
)

// asynchronousParser is an Airbyte read command result parser
type asynchronousParser struct {
	dataConsumer          base.CLIDataConsumer
	streamsRepresentation map[string]*base.StreamRepresentation
	logger                logging.TaskLogger
}

// Parse reads from stdout and:
//
//	parses airbyte output
//	applies input schemas
//	passes data as batches to dataConsumer
func (ap *asynchronousParser) parse(stdout io.Reader) error {
	startTime := timestamp.Now()
	timeInDestinations := time.Duration(0)
	totalCount := 0
	ap.logger.INFO("Airbyte sync will store data as batches >= [%d] elements size", Instance.batchSize)

	output := base.NewCLIOutputRepresentation()

	for streamName, representation := range ap.streamsRepresentation {
		output.AddStream(streamName, &base.StreamRepresentation{
			StreamName:  streamName,
			BatchHeader: &schema.BatchHeader{TableName: representation.BatchHeader.TableName, Fields: representation.BatchHeader.Fields.Clone()},
			KeyFields:   representation.KeyFields,
			Objects:     []map[string]interface{}{},
			NeedClean:   representation.NeedClean,
		})
	}

	scanner := bufio.NewScanner(stdout)
	buf := make([]byte, 0, 64*1024)
	scanner.Buffer(buf, math.MaxInt/2)

	records := 0
	for scanner.Scan() {
		lineBytes := scanner.Bytes()

		row := &Row{}
		dec := json.NewDecoder(bytes.NewReader(lineBytes))
		dec.UseNumber()
		err := dec.Decode(row)
		if err != nil {
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
			case "DEBUG":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.DEBUG)
			case "INFO":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.INFO)
			case "WARN":
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.WARN)
			default:
				ap.logger.LOG(row.Log.Message, airbyteSystem, logging.DEBUG)
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
			s, _ := output.GetStream(row.Record.Stream)
			s.Objects = append(s.Objects, row.Record.Data)
			logging.Debugf("[%s] row#%d: %+v", row.Record.Stream, totalCount+records, row.Record.Data)
		default:
			ap.logger.LOG(string(lineBytes), airbyteSystem, logging.DEBUG)
		}

		//persist batch and recreate variables
		if records >= Instance.batchSize {
			startDestinationTime := timestamp.Now()
			err := ap.dataConsumer.Consume(output)
			if err != nil {
				return err
			}
			timeInDestinations += timestamp.Now().Sub(startDestinationTime)
			totalCount += records
			//remove already persisted objects
			for _, stream := range output.GetStreams() {
				stream.Objects = []map[string]interface{}{}
			}
			output.State = nil
			records = 0
		}
	}

	//persist last batch
	if records > 0 || output.State != nil {
		startDestinationTime := timestamp.Now()
		err := ap.dataConsumer.Consume(output)
		if err != nil {
			return err
		}
		timeInDestinations += timestamp.Now().Sub(startDestinationTime)
		totalCount += records
	}

	err := scanner.Err()
	if err != nil {
		return err
	}
	totalTime := timestamp.Now().Sub(startTime)
	ap.logger.INFO("Sync finished in %s (storage time: %s), %d records processed, avg speed: %.2f records per sec", totalTime.Round(time.Second), timeInDestinations.Round(time.Second), totalCount, float64(totalCount)/totalTime.Seconds())
	return nil
}
