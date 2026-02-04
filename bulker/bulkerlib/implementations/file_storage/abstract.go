package file_storage

import (
	"bufio"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	implementations2 "github.com/jitsucom/bulker/bulkerlib/implementations"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

var fileStorageDefaultFlattener = implementations2.NewFlattener(nil, false, false)

type AbstractFileStorageStream struct {
	id           string
	mode         bulker.BulkMode
	fileAdapter  implementations2.FileAdapter
	options      bulker.StreamOptions
	namespace    string
	filenameFunc func(ctx context.Context) string

	flatten         bool
	merge           bool
	pkColumns       []string
	timestampColumn string

	batchFile              *os.File
	marshaller             types2.Marshaller
	marshallerHeaderRows   uint32
	targetMarshaller       types2.Marshaller
	eventsInBatch          uint32
	batchFileLinesByPKDisc map[string]DeduplicationLine
	batchFileLinesByPK     map[string]uint32
	batchFileSkipLines     types.Set[uint32]
	csvHeader              types.Set[string]

	firstEventTime time.Time
	lastEventTime  time.Time

	state  bulker.State
	inited bool

	startTime time.Time

	// path to discriminator field in object
	discriminatorColumn []string
	useDiscriminator    bool
}

type DeduplicationLine struct {
	lineNumber    uint32
	discriminator any
}

func newAbstractFileStorageStream(id string, p implementations2.FileAdapter, filenameFunc func(ctx context.Context) string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (AbstractFileStorageStream, error) {
	ps := AbstractFileStorageStream{id: id, fileAdapter: p, filenameFunc: filenameFunc, mode: mode}
	ps.options = bulker.StreamOptions{}
	for _, option := range streamOptions {
		ps.options.Add(option)
	}
	ps.namespace = bulker.NamespaceOption.Get(&ps.options)
	ps.merge = bulker.DeduplicateOption.Get(&ps.options)
	pkColumns := bulker.PrimaryKeyOption.Get(&ps.options)
	if ps.merge && pkColumns.Empty() {
		return AbstractFileStorageStream{}, fmt.Errorf("MergeRows option requires primary key option. Please provide WithPrimaryKey option")
	}
	ps.pkColumns = pkColumns.ToSlice()
	ps.timestampColumn = bulker.TimestampOption.Get(&ps.options)
	if ps.fileAdapter.Format() == types2.FileFormatCSV || ps.fileAdapter.Format() == types2.FileFormatNDJSONFLAT {
		ps.flatten = true
	}
	if ps.merge {
		ps.batchFileLinesByPK = make(map[string]uint32)
		ps.batchFileLinesByPKDisc = make(map[string]DeduplicationLine)
		ps.batchFileSkipLines = types.NewSet[uint32]()
		discriminatorField := bulker.DiscriminatorFieldOption.Get(&ps.options)
		if len(discriminatorField) > 0 {
			if ps.flatten {
				ps.discriminatorColumn = []string{strings.Join(discriminatorField, "_")}
			} else {
				ps.discriminatorColumn = discriminatorField
			}
			ps.useDiscriminator = true
		}
	}
	ps.csvHeader = types.NewSet[string]()
	ps.state = bulker.State{Status: bulker.Active}
	ps.startTime = time.Now()
	return ps, nil
}

func (ps *AbstractFileStorageStream) init(ctx context.Context) error {
	if ps.inited {
		return nil
	}

	if ps.batchFile == nil {
		var err error
		ps.batchFile, err = os.CreateTemp("", fmt.Sprintf("bulker_%s", utils.SanitizeString(ps.id)))
		if err != nil {
			return err
		}
		ps.marshaller, _ = types2.NewMarshaller(types2.FileFormatNDJSON, types2.FileCompressionNONE)
		ps.targetMarshaller, err = types2.NewMarshaller(ps.fileAdapter.Format(), ps.fileAdapter.Compression())
		if err != nil {
			return err
		}
		if !ps.merge && ps.fileAdapter.Format() == types2.FileFormatNDJSON {
			//without merge we can write file with compression - no need to convert
			ps.marshaller, _ = types2.NewMarshaller(ps.fileAdapter.Format(), ps.fileAdapter.Compression())
		}
		ps.marshallerHeaderRows = utils.Ternary(ps.marshaller.NeedHeader(), uint32(1), 0)
	}
	ps.inited = true
	return nil
}

func (ps *AbstractFileStorageStream) preprocess(object types2.Object) (types2.Object, error) {
	if ps.flatten {
		flatObject, err := fileStorageDefaultFlattener.FlattenObject(object, nil)
		if err != nil {
			return nil, err
		} else {
			ps.state.ProcessedRows++
			return flatObject, nil
		}
	} else {
		ps.state.ProcessedRows++
		return object, nil
	}
}

func (ps *AbstractFileStorageStream) postConsume(err error) error {
	if err != nil {
		ps.state.ErrorRowIndex = ps.state.ProcessedRows
		ps.state.SetError(err)
		return err
	} else {
		ps.state.SuccessfulRows++
	}
	return nil
}

func (ps *AbstractFileStorageStream) postComplete(err error) (bulker.State, error) {
	if ps.batchFile != nil {
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}
	if ps.merge {
		ps.batchFileLinesByPK = nil
		ps.batchFileLinesByPKDisc = nil
		ps.batchFileSkipLines = nil
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

func (ps *AbstractFileStorageStream) flushBatchFile(ctx context.Context) (err error) {
	if ps.merge {
		ps.batchFileLinesByPK = make(map[string]uint32)
		ps.batchFileLinesByPKDisc = make(map[string]DeduplicationLine)
	}
	defer func() {
		if ps.merge {
			ps.batchFileSkipLines = types.NewSet[uint32]()
		}
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}()
	if ps.eventsInBatch > 0 {

		err = ps.marshaller.Flush()
		if err != nil {
			return errorj.Decorate(err, "failed to flush marshaller")
		}
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
		workingFile := ps.batchFile
		needToConvert := false
		convertStart := time.Now()
		if !ps.targetMarshaller.Equal(ps.marshaller) {
			needToConvert = true
		}
		if len(ps.batchFileSkipLines) > 0 || needToConvert {
			var writer io.WriteCloser
			var gzipWriter io.WriteCloser
			workingFile, err = os.CreateTemp("", path.Base(ps.batchFile.Name())+"_2")
			if err != nil {
				return errorj.Decorate(err, "failed to create tmp file for deduplication")
			}
			defer func() {
				_ = workingFile.Close()
				_ = os.Remove(workingFile.Name())
			}()
			writer = workingFile
			if needToConvert {
				header := ps.csvHeader.ToSlice()
				sort.Strings(header)
				err = ps.targetMarshaller.Init(workingFile, header)
				if err != nil {
					return errorj.Decorate(err, "failed to write header for converted batch file")
				}
			} else {
				if ps.targetMarshaller.Compression() == types2.FileCompressionGZIP {
					gzipWriter = gzip.NewWriter(writer)
					writer = gzipWriter
					defer func() { _ = gzipWriter.Close() }()
				}
			}
			file, err := os.Open(ps.batchFile.Name())
			if err != nil {
				return errorj.Decorate(err, "failed to open tmp file")
			}
			defer func() {
				_ = file.Close()
			}()
			scanner := bufio.NewScanner(file)
			scanner.Buffer(make([]byte, 1024*10), 1024*1024*50)
			var i uint32
			for scanner.Scan() {
				if !ps.batchFileSkipLines.Contains(i) {
					if needToConvert {
						var obj types2.Object
						err := jsonorder.Unmarshal(scanner.Bytes(), &obj)
						if err != nil {
							return errorj.Decorate(err, "failed to decode json object from batch filer")
						}
						err = ps.targetMarshaller.Marshal(obj)
						if err != nil {
							return errorj.Decorate(err, "failed to marshall object to target format")
						}
					} else {
						_, err = writer.Write(scanner.Bytes())
						if err != nil {
							return errorj.Decorate(err, "failed write to deduplication file")
						}
						_, _ = writer.Write([]byte("\n"))
					}
				}
				i++
			}
			if err = scanner.Err(); err != nil {
				return errorj.Decorate(err, "failed to read batch file")
			}
			_ = ps.targetMarshaller.Flush()
			if gzipWriter != nil {
				_ = gzipWriter.Close()
			}
			_ = workingFile.Sync()
		}
		if needToConvert {
			stat, _ = workingFile.Stat()
			var convertedSizeMb float64
			if stat != nil {
				convertedSizeMb = float64(stat.Size()) / 1024 / 1024
			}
			logging.Infof("[%s] Converted batch file from %s (%.2f mb) to %s (%.2f mb) in %.2f s.", ps.id, ps.marshaller.FileExtension(), batchSizeMb, ps.targetMarshaller.FileExtension(), convertedSizeMb, time.Since(convertStart).Seconds())
		}
		//create file reader for workingFile
		_, err = workingFile.Seek(0, 0)
		if err != nil {
			return errorj.Decorate(err, "failed to seek to beginning of tmp file")
		}
		fileName := ps.filename(ctx)
		ps.state.Representation = map[string]string{
			"name": ps.fileAdapter.Path(fileName),
		}
		loadTime := time.Now()
		err = ps.fileAdapter.Upload(fileName, workingFile)
		if err != nil {
			return errorj.Decorate(err, "failed to flush tmp file to the warehouse")
		} else {
			logging.Debugf("[%s] Batch file loaded to %s in %.2f s.", ps.id, ps.fileAdapter.Type(), time.Since(loadTime).Seconds())
		}
	}
	return nil
}

func (ps *AbstractFileStorageStream) getPKValue(object types2.Object) (string, error) {
	pkColumns := ps.pkColumns
	l := len(pkColumns)
	if l == 0 {
		return "", fmt.Errorf("primary key is not set")
	}
	if l == 1 {
		pkValue := object.GetN(pkColumns[0])
		if str, ok := pkValue.(string); ok {
			return str, nil
		}
		return fmt.Sprint(pkValue), nil
	}
	var buf strings.Builder
	buf.Grow(48)
	for i, col := range pkColumns {
		if i > 0 {
			buf.WriteByte('\x00')
		}
		pkValue := object.GetN(col)
		switch v := pkValue.(type) {
		case nil:
			buf.WriteString("<nil>")
		case string:
			buf.WriteString(v)
		case time.Time:
			var tmp [8]byte
			buf.Write(strconv.AppendInt(tmp[:0], v.UnixMilli(), 36))
		default:
			fmt.Fprint(&buf, v)
		}
	}
	return buf.String(), nil
}

func (ps *AbstractFileStorageStream) writeToBatchFile(ctx context.Context, processedObject types2.Object) error {
	ps.marshaller.Init(ps.batchFile, nil)
	if ps.merge {
		pk, err := ps.getPKValue(processedObject)
		if err != nil {
			return err
		}
		lineNumber := ps.eventsInBatch + ps.marshallerHeaderRows
		if ps.useDiscriminator {
			var newDiscriminator = processedObject.GetPathN(ps.discriminatorColumn)
			prevLine, ok := ps.batchFileLinesByPKDisc[pk]
			if ok {
				cmpr := utils.CompareAny(newDiscriminator, prevLine.discriminator)
				if cmpr >= 0 {
					ps.batchFileSkipLines.Put(prevLine.lineNumber)
					ps.batchFileLinesByPKDisc[pk] = DeduplicationLine{lineNumber, newDiscriminator}
				} else {
					ps.batchFileSkipLines.Put(lineNumber)
				}
			} else {
				ps.batchFileLinesByPKDisc[pk] = DeduplicationLine{lineNumber, newDiscriminator}
			}
		} else {
			prevLineNumber, ok := ps.batchFileLinesByPK[pk]
			if ok {
				ps.batchFileSkipLines.Put(prevLineNumber)
			}
			ps.batchFileLinesByPK[pk] = lineNumber
		}
	}
	err := ps.marshaller.Marshal(processedObject)
	if err != nil {
		return errorj.Decorate(err, "failed to marshall into json file")
	}
	ps.eventsInBatch++
	return nil
}

func (ps *AbstractFileStorageStream) ConsumeJSON(ctx context.Context, json []byte) (state bulker.State, processedObject types2.Object, err error) {
	var obj types2.Object
	err = jsonorder.Unmarshal(json, &obj)
	if err != nil {
		return ps.state, nil, fmt.Errorf("Error parsing JSON: %v", err)
	}
	return ps.Consume(ctx, obj)
}

func (ps *AbstractFileStorageStream) ConsumeMap(ctx context.Context, mp map[string]any) (state bulker.State, processedObject types2.Object, err error) {
	return ps.Consume(ctx, types2.ObjectFromMap(mp))
}

func (ps *AbstractFileStorageStream) Consume(ctx context.Context, object types2.Object) (state bulker.State, processedObject types2.Object, err error) {
	defer func() {
		err = ps.postConsume(err)
		state = ps.state
	}()
	if err = ps.init(ctx); err != nil {
		return
	}
	eventTime := ps.getEventTime(object)
	if ps.lastEventTime.IsZero() || eventTime.After(ps.lastEventTime) {
		ps.lastEventTime = eventTime
	}
	if ps.firstEventTime.IsZero() || eventTime.Before(ps.firstEventTime) {
		ps.firstEventTime = eventTime
	}

	//type mapping, flattening => table schema
	processedObject, err = ps.preprocess(object)
	if err != nil {
		return
	}

	if ps.targetMarshaller.Format() == types2.FileFormatCSV {
		ps.csvHeader.PutAllOrderedKeys(processedObject)
	}

	err = ps.writeToBatchFile(ctx, processedObject)

	return
}

func (ps *AbstractFileStorageStream) Abort(ctx context.Context) (state bulker.State) {
	if ps.state.Status != bulker.Active {
		return ps.state
	}
	if ps.batchFile != nil {
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}
	if ps.merge {
		ps.batchFileLinesByPK = nil
		ps.batchFileLinesByPKDisc = nil
		ps.batchFileSkipLines = nil
	}
	ps.state.Status = bulker.Aborted
	return ps.state
}

func (ps *AbstractFileStorageStream) filename(ctx context.Context) string {
	fileName := utils.JoinNonEmptyStrings("/", ps.namespace, ps.filenameFunc(ctx))
	fileName = ps.fileAdapter.AddFileExtension(fileName)
	return fileName
}

func (ps *AbstractFileStorageStream) getEventTime(object types2.Object) time.Time {
	if ps.timestampColumn != "" {
		tm, ok := types2.ReformatTimeValue(object.GetN(ps.timestampColumn), false)
		if ok {
			return tm
		}
	}
	return time.Now()
}

func (ps *AbstractFileStorageStream) Complete(ctx context.Context) (state bulker.State, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, errors.New("stream is not active")
	}
	defer func() {
		state, err = ps.postComplete(err)
	}()
	if ps.state.LastError == nil {
		//if at least one object was inserted
		if ps.state.SuccessfulRows > 0 {
			if ps.batchFile != nil {
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
