package events

const SrcBulk = "bulk"

//BulkProcessor preprocess server 2 server bulk integration events
type BulkProcessor struct {
}

//NewBulkProcessor returns new BulkProcessor
func NewBulkProcessor() *BulkProcessor {
	return &BulkProcessor{}
}

//Preprocess puts src = bulk if doesn't exist
func (bp *BulkProcessor) Preprocess(event Event, requestContext *RequestContext) {
	if _, ok := event[SrcKey]; !ok {
		event[SrcKey] = SrcBulk
	}
}

//Postprocess does nothing
func (bp *BulkProcessor) Postprocess(event Event, eventID string, destinationIDs []string, tokenID string) {
}

//Type returns preprocessor type
func (bp *BulkProcessor) Type() string {
	return bulkPreprocessorType
}
