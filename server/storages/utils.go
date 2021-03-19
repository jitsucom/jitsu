package storages

import (
	"bytes"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
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

func dryRun(payload events.Event, processor *schema.Processor, tableHelper *TableHelper) ([]adapters.TableField, error) {
	batchHeader, event, err := processor.ProcessEvent(payload)
	if err != nil {
		return nil, err
	}

	tableSchema := tableHelper.MapTableSchema(batchHeader)
	var dryRunResponses []adapters.TableField

	for name, column := range tableSchema.Columns {
		dryRunResponses = append(dryRunResponses, adapters.TableField{Field: name, Type: column.SqlType, Value: event[name]})
	}

	return dryRunResponses, nil
}
