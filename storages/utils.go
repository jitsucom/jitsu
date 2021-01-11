package storages

import (
	"bytes"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/schema"
)

//return rows count from byte array
func linesCount(s []byte) int {
	nl := []byte{'\n'}
	n := bytes.Count(s, nl)
	if len(s) > 0 && !bytes.HasSuffix(s, nl) {
		n++
	}
	return n
}

func dryRun(payload events.Event, processor *schema.Processor, tableHelper *TableHelper) ([]DryRunResponse, error) {
	batchHeader, event, err := processor.ProcessEvent(payload)
	if err != nil {
		return nil, err
	}
	tableSchema := tableHelper.MapTableSchema(batchHeader)
	var dryRunResponses []DryRunResponse
	for name, column := range tableSchema.Columns {
		dryRunResponses = append(dryRunResponses, DryRunResponse{Name: name, Type: column.SqlType, Value: event[name]})
	}
	return dryRunResponses, nil
}
