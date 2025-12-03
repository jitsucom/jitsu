package api_based

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type ApiImplementation interface {
	io.Closer
	Type() string
	Upload(reader io.Reader, eventsName string, eventsCount int, env map[string]any) (int, string, error)
	GetBatchFileFormat() types2.FileFormat
	GetBatchFileCompression() types2.FileCompression
	InmemoryBatch() bool
}

type ApiBasedStream struct {
	id             string
	options        bulker.StreamOptions
	implementation ApiImplementation

	eventsName         string
	batchFile          *os.File
	batchBuffer        *bytes.Buffer
	inmemoryBatch      bool
	temporaryBatchSize int

	marshaller    types2.Marshaller
	eventsInBatch int
	env           map[string]any

	state  bulker.State
	inited bool

	startTime time.Time
}

func NewTransactionalStream(id string, impl ApiImplementation, eventsName string, streamOptions ...bulker.StreamOption) (*ApiBasedStream, error) {
	ps := ApiBasedStream{id: id, implementation: impl}
	ps.options = bulker.StreamOptions{}
	for _, option := range streamOptions {
		ps.options.Add(option)
	}
	ps.state = bulker.State{Status: bulker.Active, Representation: map[string]string{
		"name": impl.Type(),
	}}
	ps.env = bulker.FunctionsEnvOption.Get(&ps.options)
	ps.temporaryBatchSize = bulker.TemporaryBatchSizeOption.Get(&ps.options)
	ps.eventsName = eventsName
	ps.startTime = time.Now()
	ps.inmemoryBatch = impl.InmemoryBatch()
	return &ps, nil
}

func (ps *ApiBasedStream) init(ctx context.Context) error {
	if ps.inited {
		return nil
	}

	err := ps.initBatch(ctx)
	if err != nil {
		return err
	}
	ps.inited = true
	return nil
}

func (ps *ApiBasedStream) preprocess(object types2.Object) (types2.Object, error) {
	ps.state.ProcessedRows++
	return object, nil
}

func (ps *ApiBasedStream) postConsume(err error) error {
	if err != nil {
		ps.state.ErrorRowIndex = ps.state.ProcessedRows
		ps.state.SetError(err)
		return err
	} else {
		ps.state.SuccessfulRows++
	}
	return nil
}

func (ps *ApiBasedStream) postComplete(err error) (bulker.State, error) {
	if ps.batchFile != nil {
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}
	if ps.batchBuffer != nil {
		ps.batchBuffer = nil
	}
	if err != nil {
		ps.state.SetError(err)
		ps.state.Status = bulker.Failed
	} else {
		sec := time.Since(ps.startTime).Seconds()
		logging.Debugf("[%s] Stream completed successfully in %.2f s. Avg Speed: %.2f events/sec.", ps.id, sec, float64(ps.state.SuccessfulRows)/sec)
		ps.state.Status = bulker.Completed
	}
	return ps.state, err
}

func (ps *ApiBasedStream) flushBatchFile(ctx context.Context) (err error) {
	defer func() {
		if ps.batchFile != nil {
			_ = ps.batchFile.Close()
			_ = os.Remove(ps.batchFile.Name())
			ps.batchFile = nil
		}
		if ps.batchBuffer != nil {
			ps.batchBuffer = nil
		}
		ps.eventsInBatch = 0
	}()
	if ps.eventsInBatch > 0 {
		err = ps.marshaller.Flush()
		if err != nil {
			return errorj.Decorate(err, "failed to flush marshaller")
		}
		var batch io.Reader
		if ps.inmemoryBatch {
			sec := time.Since(ps.startTime).Seconds()
			batchSizeMb := float64(ps.batchBuffer.Len()) / 1024 / 1024
			logging.Debugf("[%s] Flushed %d events to batch buffer. Size: %.2f mb in %.2f s. Speed: %.2f mb/s", ps.id, ps.eventsInBatch, batchSizeMb, sec, batchSizeMb/sec)
			batch = ps.batchBuffer
		} else {
			err = ps.batchFile.Sync()
			if err != nil {
				return errorj.Decorate(err, "failed to sync batch file")
			}
			stat, _ := ps.batchFile.Stat()
			var batchSizeMb float64
			if stat != nil {
				batchSizeMb = float64(stat.Size()) / 1024 / 1024
				sec := time.Since(ps.startTime).Seconds()
				logging.Debugf("[%s] Flushed %d events to batch file. Size: %.2f mb in %.2f s. Speed: %.2f mb/s", ps.id, ps.eventsInBatch, batchSizeMb, sec, batchSizeMb/sec)
			}
			_, err = ps.batchFile.Seek(0, 0)
			if err != nil {
				return errorj.Decorate(err, "failed to seek to beginning of tmp file")
			}
			batch = ps.batchFile
		}

		loadTime := time.Now()
		status, resp, err := ps.implementation.Upload(batch, ps.eventsName, ps.eventsInBatch, ps.env)
		if err != nil {
			return fmt.Errorf("failed to upload data to %s code: %d resp: %s error: %w", ps.implementation.Type(), status, resp, err)
		} else {
			ps.state.Representation = map[string]any{
				"name":     ps.implementation.Type(),
				"status":   status,
				"response": resp,
			}
			if status >= 200 && status < 300 {
				logging.Debugf("[%s] Batch file loaded to %s in %.2f s. Response: %s", ps.id, ps.implementation.Type(), time.Since(loadTime).Seconds(), resp)
			} else {
				logging.Warnf("[%s] Batch file loaded to %s in %.2f s. Response: %s", ps.id, ps.implementation.Type(), time.Since(loadTime).Seconds(), resp)
			}
		}
	}
	return nil
}

func (ps *ApiBasedStream) initBatch(ctx context.Context) (err error) {
	if ps.inmemoryBatch {
		ps.batchBuffer = &bytes.Buffer{}
	} else if ps.batchFile == nil {
		var err error
		ps.batchFile, err = os.CreateTemp("", fmt.Sprintf("bulker_%s", utils.SanitizeString(ps.id)))
		if err != nil {
			return err
		}
	}
	ps.marshaller, _ = types2.NewMarshaller(ps.implementation.GetBatchFileFormat(), ps.implementation.GetBatchFileCompression())
	return nil
}

func (ps *ApiBasedStream) writeToBatch(ctx context.Context, processedObject types2.Object) error {
	if ps.temporaryBatchSize > 0 && ps.eventsInBatch >= ps.temporaryBatchSize {
		err := ps.flushBatchFile(ctx)
		if err != nil {
			return err
		}
		err = ps.initBatch(ctx)
		if err != nil {
			return err
		}
	}
	if ps.inmemoryBatch {
		_ = ps.marshaller.Init(ps.batchBuffer, nil)
	} else {
		_ = ps.marshaller.Init(ps.batchFile, nil)
	}
	err := ps.marshaller.Marshal(processedObject)
	if err != nil {
		return errorj.Decorate(err, "failed to marshall into json file")
	}
	ps.eventsInBatch++
	return nil
}

func (ps *ApiBasedStream) ConsumeJSON(ctx context.Context, json []byte) (state bulker.State, processedObject types2.Object, err error) {
	var obj types2.Object
	err = jsonorder.Unmarshal(json, &obj)
	if err != nil {
		return ps.state, nil, fmt.Errorf("Error parsing JSON: %v", err)
	}
	return ps.Consume(ctx, obj)
}

func (ps *ApiBasedStream) ConsumeMap(ctx context.Context, mp map[string]any) (state bulker.State, processedObject types2.Object, err error) {
	return ps.Consume(ctx, types2.ObjectFromMap(mp))
}

func (ps *ApiBasedStream) Consume(ctx context.Context, object types2.Object) (state bulker.State, processedObject types2.Object, err error) {
	defer func() {
		err = ps.postConsume(err)
		state = ps.state
	}()
	if err = ps.init(ctx); err != nil {
		return
	}

	//type mapping, flattening => table schema
	processedObject, err = ps.preprocess(object)
	if err != nil {
		return
	}

	err = ps.writeToBatch(ctx, processedObject)

	return
}

func (ps *ApiBasedStream) Abort(ctx context.Context) (state bulker.State) {
	if ps.state.Status != bulker.Active {
		return ps.state
	}
	if ps.batchFile != nil {
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}
	if ps.batchBuffer != nil {
		ps.batchBuffer = nil
	}
	ps.state.Status = bulker.Aborted
	return ps.state
}

func (ps *ApiBasedStream) Complete(ctx context.Context) (state bulker.State, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, errors.New("stream is not active")
	}
	defer func() {
		state, err = ps.postComplete(err)
	}()
	if ps.state.LastError == nil {
		//if at least one object was inserted
		if ps.state.SuccessfulRows > 0 {
			if ps.batchFile != nil || ps.batchBuffer != nil {
				if err = ps.flushBatchFile(ctx); err != nil {
					return ps.state, err
				}
			}
		}
		return
	} else {
		//if was any error - it will trigger transaction rollback in defer func
		err = ps.state.LastError
		return
	}
}
