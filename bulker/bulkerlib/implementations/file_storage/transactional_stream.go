package file_storage

import (
	"context"
	"fmt"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
)

const FilenameDate = "2006_01_02T15_04_05"

type TransactionalStream struct {
	AbstractFileStorageStream
}

func NewTransactionalStream(id string, p implementations.FileAdapter, tableName string, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	ps := TransactionalStream{}
	var err error
	streamStartDate := timestamp.Now()
	filenameFunc := func(ctx context.Context) string {
		batchNumStr := ""
		batchNum, ok := ctx.Value(bulker.BatchNumberCtxKey).(int)
		if ok {
			batchNumStr = fmt.Sprintf("_%d", batchNum)
		} else if suffix, ok := ctx.Value(bulker.BatchSuffixCtxKey).(string); ok && suffix != "" {
			batchNumStr = "_" + suffix
		}
		return fmt.Sprintf("%s_%s%s", tableName, streamStartDate.Format(FilenameDate), batchNumStr)
	}
	ps.AbstractFileStorageStream, err = newAbstractFileStorageStream(id, p, filenameFunc, bulker.Batch, streamOptions...)
	if err != nil {
		return nil, err
	}
	return &ps, nil
}
