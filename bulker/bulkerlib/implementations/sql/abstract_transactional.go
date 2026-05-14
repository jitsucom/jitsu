package sql

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	types2 "github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type AbstractTransactionalSQLStream struct {
	*AbstractSQLStream
	tx       *TxSQLAdapter
	tmpTable *Table
	//function that generate tmp table schema based on target table schema
	tmpTableFunc           func(ctx context.Context, tableForObject *Table, object types.Object) (table *Table)
	dstTable               *Table
	temporaryBatchSize     uint32
	temporaryBatchCounter  int
	localBatchFileName     string
	batchFile              *os.File
	marshaller             types.Marshaller
	marshallerHeaderRows   uint32
	targetMarshaller       types.Marshaller
	eventsInBatch          uint32
	minTimestampInBatch    *time.Time
	s3                     *implementations.S3
	batchFileLinesByPK     map[string]uint32
	batchFileLinesByPKDisc map[string]DeduplicationLine
	batchFileSkipLines     types2.Set[uint32]
	// path to discriminator field in object
	discriminatorColumn  string
	useDiscriminator     bool
	doLocalDeduplication bool
	// loadExistingTable whether to load an existing table schema on init
	loadExistingTable bool
}

type DeduplicationLine struct {
	lineNumber    uint32
	discriminator any
}

func newAbstractTransactionalStream(id string, p SQLAdapter, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (*AbstractTransactionalSQLStream, error) {
	abs, err := newAbstractStream(id, p, tableName, mode, streamOptions...)
	if err != nil {
		return nil, err
	}
	ps := AbstractTransactionalSQLStream{}
	ps.AbstractSQLStream = abs
	ps.existingTable = &Table{}
	if ps.merge {
		ps.batchFileLinesByPKDisc = make(map[string]DeduplicationLine)
		ps.batchFileLinesByPK = make(map[string]uint32)
		ps.batchFileSkipLines = types2.NewSet[uint32]()
		discriminatorField := bulker.DiscriminatorFieldOption.Get(&ps.options)
		if len(discriminatorField) > 0 {
			ps.discriminatorColumn = p.ColumnName(ps.nameTransformer(strings.Join(discriminatorField, "_")))
			ps.useDiscriminator = true
		}
	}
	ps.doLocalDeduplication = p.DoLocalDeduplication()
	ps.localBatchFileName = localBatchFileOption.Get(&ps.options)
	ps.temporaryBatchSize = uint32(bulker.TemporaryBatchSizeOption.Get(&ps.options))
	return &ps, nil
}

func (ps *AbstractTransactionalSQLStream) initTmpFile(_ context.Context) (err error) {
	if ps.batchFile == nil {
		if (!ps.merge || !ps.doLocalDeduplication) && ps.sqlAdapter.GetBatchFileFormat() == types.FileFormatNDJSON {
			//without local deduplication we can write file with compression - no need to convert
			ps.marshaller, _ = types.NewMarshaller(ps.sqlAdapter.GetBatchFileFormat(), ps.sqlAdapter.GetBatchFileCompression())
		} else {
			ps.marshaller, _ = types.NewMarshaller(types.FileFormatNDJSON, types.FileCompressionNONE)
		}
		ps.targetMarshaller, err = types.NewMarshaller(ps.sqlAdapter.GetBatchFileFormat(), ps.sqlAdapter.GetBatchFileCompression())
		if err != nil {
			return err
		}
		ps.batchFile, err = os.CreateTemp("", ps.localBatchFileName+"_*"+ps.marshaller.FileExtension())
		ps.marshallerHeaderRows = utils.Ternary(ps.marshaller.NeedHeader(), uint32(1), 0)
	}
	return
}

func (ps *AbstractTransactionalSQLStream) init(ctx context.Context) (err error) {
	if ps.inited {
		return nil
	}
	s3 := s3BatchFileOption.Get(&ps.options)
	if s3 != nil {
		s3Config := implementations.S3Config{
			AuthenticationMethod: s3.AuthenticationMethod,
			AccessKeyID:          s3.AccessKeyID,
			SecretAccessKey:      s3.SecretAccessKey,
			Bucket:               s3.Bucket,
			Region:               s3.Region,
			RoleARN:              s3.RoleARN,
			ExternalID:           s3.ExternalID,
			UsePresignedURL:      s3.UsePresignedURL,
			FileConfig: implementations.FileConfig{Format: ps.sqlAdapter.GetBatchFileFormat(),
				Folder:      s3.Folder,
				Compression: ps.sqlAdapter.GetBatchFileCompression()}}
		ps.s3, err = implementations.NewS3(&s3Config)
		if err != nil {
			return fmt.Errorf("failed to setup s3 client: %v", err)
		}
	}
	if ps.localBatchFileName != "" && ps.batchFile == nil {
		err = ps.initTmpFile(ctx)
		if err != nil {
			return
		}
	}
	err = ps.AbstractSQLStream.init(ctx)
	if err != nil {
		return err
	}
	if ps.loadExistingTable {
		ctx1, cancel := context.WithTimeout(ctx, time.Second*290)
		defer cancel()
		ps.existingTable, _ = ps.sqlAdapter.GetTableSchema(ctx1, ps.namespace, ps.tableName)
		if ps.existingTable.Exists() {
			ps.sqlAdapter.TableHelper().UpdateCached(ps.existingTable)
			//for el := ps.existingTable.Columns.Front(); el != nil; el = el.Next() {
			//	if el.Value.DataType == types.JSON {
			//		if ps.notFlatteningKeys == nil {
			//			ps.notFlatteningKeys = types2.NewSet[string](el.Key)
			//		} else {
			//			ps.notFlatteningKeys.Put(el.Key)
			//		}
			//	}
			//}
		} else {
			ps.sqlAdapter.TableHelper().ClearCached(ps.sqlAdapter.NamespaceName(ps.namespace), ps.tableName)
		}
		ps.initialColumnsCount = ps.existingTable.ColumnsCount()
	}
	return nil
}

func (ps *AbstractTransactionalSQLStream) initTx(ctx context.Context) (err error) {
	err = ps.init(ctx)
	if err != nil {
		return err
	}
	if ps.tx == nil {
		ctx1, cancel := context.WithTimeout(ctx, time.Second*290)
		defer cancel()
		if time.Since(ps.lastPing) > 5*time.Minute {
			if err = ps.sqlAdapter.Ping(ctx1); err != nil {
				return err
			}
			ps.lastPing = time.Now()
		}
		ps.tx, err = ps.sqlAdapter.OpenTx(ctx)
		if err != nil {
			return err
		}
	}
	return nil
}

func (ps *AbstractTransactionalSQLStream) postComplete(ctx context.Context, err error) (bulker.State, error) {
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
		ps.state.SuccessfulRows = 0
		if ps.tx != nil {
			if ps.tmpTable != nil {
				_ = ps.tx.Drop(ctx, ps.tmpTable, true)
			}
			_ = ps.tx.Rollback()
		}
	} else {
		sec := time.Since(ps.startTime).Seconds()
		logging.Debugf("[%s] Stream completed successfully in %.2f s. Avg Speed: %.2f events/sec.", ps.id, sec, float64(ps.state.SuccessfulRows)/sec)
		if ps.tx != nil {
			if ps.tmpTable != nil {
				err = ps.tx.Drop(ctx, ps.tmpTable, true)
				if err != nil {
					logging.Errorf("[%s] Failed to drop tmp table: %v", ps.id, err)
				}
			}
			err = ps.tx.Commit()
		}
	}

	return ps.AbstractSQLStream.postComplete(err)
}

func (ps *AbstractTransactionalSQLStream) flushBatchFile(ctx context.Context) (state bulker.WarehouseState, err error) {
	tmpTable := ps.tmpTable
	if ps.merge {
		ps.batchFileLinesByPKDisc = make(map[string]DeduplicationLine)
		ps.batchFileLinesByPK = make(map[string]uint32)
	}
	defer func() {
		if ps.merge {
			ps.batchFileSkipLines = types2.NewSet[uint32]()
		}
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
		ps.batchFile = nil
		ps.eventsInBatch = 0
		ps.temporaryBatchCounter++
	}()
	if ps.batchFile != nil && ps.eventsInBatch > 0 {
		err = ps.marshaller.Flush()
		if err != nil {
			return state, errorj.Decorate(err, "failed to flush marshaller")
		}
		err = ps.batchFile.Sync()
		if err != nil {
			return state, errorj.Decorate(err, "failed to sync batch file")
		}
		stat, err := ps.batchFile.Stat()
		if err != nil {
			return state, errorj.Decorate(err, "failed to stat batch file")
		}

		batchSize := stat.Size()
		batchSizeMb := float64(batchSize) / 1024 / 1024
		sec := time.Since(ps.startTime).Seconds()
		logging.Debugf("[%s] Flushed %d events to batch file. Size: %.2f mb in %.2f s. Speed: %.2f mb/s", ps.id, ps.eventsInBatch, batchSizeMb, sec, batchSizeMb/sec)
		//TODO: wrong time measurements if tmp batch size is set (only in sync case )
		state.Merge(bulker.WarehouseState{
			Name:            "consume",
			BytesProcessed:  int(batchSize),
			TimeProcessedMs: time.Since(ps.startTime).Milliseconds(),
		})

		ps.updateRepresentationTable(tmpTable)
		err = ps.initTx(ctx)
		if err != nil {
			return state, errorj.Decorate(err, "failed to init transaction")
		}
		if ps.temporaryBatchCounter == 0 {
			_, err = ps.tx.CreateTable(ctx, tmpTable)
		} else {
			_, err = ps.sqlAdapter.TableHelper().EnsureTableWithoutCaching(ctx, ps.tx, ps.id, tmpTable)
		}
		if err != nil {
			return state, errorj.Decorate(err, "failed to create table")
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
			workingFile, err = os.CreateTemp("", path.Base(ps.batchFile.Name())+"_*"+ps.targetMarshaller.FileExtension())
			if err != nil {
				return state, errorj.Decorate(err, "failed to create tmp file for deduplication")
			}
			defer func() {
				_ = workingFile.Close()
				_ = os.Remove(workingFile.Name())
			}()
			writer = workingFile
			if needToConvert {
				err = ps.targetMarshaller.InitSchema(workingFile, tmpTable.ColumnNames(), ps.sqlAdapter.GetAvroSchema(tmpTable))
				if err != nil {
					return state, errorj.Decorate(err, "failed to write header for converted batch file")
				}
			} else {
				if ps.targetMarshaller.Compression() == types.FileCompressionGZIP {
					gzipWriter = gzip.NewWriter(writer)
					writer = gzipWriter
					defer func() { _ = gzipWriter.Close() }()
				}
			}
			file, err := os.Open(ps.batchFile.Name())
			if err != nil {
				return state, errorj.Decorate(err, "failed to open tmp file")
			}
			defer func() {
				_ = file.Close()
			}()
			scanner := bufio.NewScanner(file)
			scanner.Buffer(make([]byte, 1024*10), 1024*1024*100)
			var i uint32
			for scanner.Scan() {
				if !ps.batchFileSkipLines.Contains(i) {
					if needToConvert {
						cfg := jsonorder.ConfigDefault
						if ps.targetMarshaller.Format() == types.FileFormatAVRO {
							cfg = jsonorder.ConfigNoNumbers
						}
						var obj types.Object
						err = cfg.Unmarshal(scanner.Bytes(), &obj)
						if err != nil {
							return state, errorj.Decorate(err, "failed to decode json object from batch filer")
						}
						err = ps.targetMarshaller.Marshal(obj)
						if err != nil {
							return state, errorj.Decorate(err, "failed to marshal object to converted batch file")
						}
					} else {
						_, err = writer.Write(scanner.Bytes())
						if err != nil {
							return state, errorj.Decorate(err, "failed write to deduplication file")
						}
						_, _ = writer.Write([]byte("\n"))
					}
				}
				i++
			}
			if err = scanner.Err(); err != nil {
				return state, errorj.Decorate(err, "failed to read batch file")
			}
			_ = ps.targetMarshaller.Flush()
			if gzipWriter != nil {
				_ = gzipWriter.Close()
			}
			_ = workingFile.Sync()
			state.Merge(bulker.WarehouseState{
				Name:            "convert",
				BytesProcessed:  int(batchSize),
				TimeProcessedMs: time.Since(convertStart).Milliseconds(),
			})
			if needToConvert {
				stat, _ = workingFile.Stat()
				var convertedSizeMb float64
				if stat != nil {
					batchSize = stat.Size()
					convertedSizeMb = float64(batchSize) / 1024 / 1024
				}
				logging.Infof("[%s] Converted batch file from %s (%.2f mb) to %s (%.2f mb) in %.2f s.", ps.id, ps.marshaller.FileExtension(), batchSizeMb, ps.targetMarshaller.FileExtension(), convertedSizeMb, time.Since(convertStart).Seconds())
			}
		}
		state.Merge(bulker.WarehouseState{
			Name:           "batch_size",
			BytesProcessed: int(batchSize),
		})
		loadTime := time.Now()
		if ps.s3 != nil {
			s3Config := s3BatchFileOption.Get(&ps.options)
			rFile, err := os.Open(workingFile.Name())
			if err != nil {
				return state, errorj.Decorate(err, "failed to open tmp file")
			}
			defer func() {
				_ = rFile.Close()
			}()
			s3FileName := path.Base(workingFile.Name())
			uploadStart := time.Now()
			err = ps.s3.Upload(s3FileName, rFile)
			if err != nil {
				return state, errorj.Decorate(err, "failed to upload file to s3")
			}
			defer ps.s3.DeleteObject(s3FileName)
			var url string
			url, err = ps.s3.GetObjectURL(s3FileName)
			if err != nil {
				return state, errorj.Decorate(err, "failed to get s3 object url")
			}
			state.Merge(bulker.WarehouseState{
				Name:            "upload_to_s3",
				BytesProcessed:  int(batchSize),
				TimeProcessedMs: time.Since(uploadStart).Milliseconds(),
			})
			logging.Infof("[%s] Batch file uploaded to s3 in %.2f s.", ps.id, time.Since(loadTime).Seconds())
			loadTime = time.Now()
			loadState, err := ps.tx.LoadTable(ctx, tmpTable, &LoadSource{Type: AmazonS3, Path: s3FileName, URL: url, Format: ps.sqlAdapter.GetBatchFileFormat(), S3Config: s3Config})
			state.Merge(loadState)
			if err != nil {
				return state, errorj.Decorate(err, "failed to flush tmp file to the warehouse")
			} else {
				logging.Debugf("[%s] Batch file loaded to %s in %.2f s.", ps.id, ps.sqlAdapter.Type(), time.Since(loadTime).Seconds())
			}
		} else {
			loadState, err := ps.tx.LoadTable(ctx, tmpTable, &LoadSource{Type: LocalFile, Path: workingFile.Name(), Format: ps.sqlAdapter.GetBatchFileFormat()})
			state.Merge(loadState)
			if err != nil {
				return state, errorj.Decorate(err, "failed to flush tmp file to the warehouse")
			} else {
				logging.Debugf("[%s] Batch file loaded to %s in %.2f s.", ps.id, ps.sqlAdapter.Type(), time.Since(loadTime).Seconds())
			}
		}
	}
	return
}

//func (ps *AbstractTransactionalSQLStream) ensureSchema(ctx context.Context, targetTable **Table, tableForObject *Table, initTable func(ctx context.Context) (*Table, error)) (err error) {
//	needRenewTmpTable := false
//	//first object
//	if *targetTable == nil {
//		*targetTable, err = initTable(ctx)
//		if err != nil {
//			return err
//		}
//		needRenewTmpTable = true
//	} else {
//		if !tableForObject.FitsToTable(*targetTable) {
//			needRenewTmpTable = true
//			if ps.batchFile != nil {
//				logging.Infof("[%s] Table schema changed during transaction. New columns: %v", ps.id, tableForObject.Diff(*targetTable).Columns)
//				if err = ps.flushBatchFile(ctx, *targetTable, false); err != nil {
//					return err
//				}
//			}
//			(*targetTable).Columns = utils.MapPutAll(tableForObject.Columns, (*targetTable).Columns)
//		}
//	}
//	if needRenewTmpTable {
//		//adapt tmp table for new object columns if any
//		*targetTable, err = ps.tableHelper.EnsureTableWithCaching(ctx, ps.id, *targetTable)
//		if err != nil {
//			return errorj.Decorate(err, "failed to ensure temporary table")
//		}
//		if ps.batchFile != nil {
//			err = ps.marshaller.WriteHeader((*targetTable).ColumnNames(), ps.batchFile)
//			if err != nil {
//				return errorj.Decorate(err, "failed write csv header")
//			}
//		}
//	}
//	return nil
//}

func (ps *AbstractTransactionalSQLStream) writeToBatchFile(ctx context.Context, targetTable *Table, processedObject types.Object) error {
	if ps.temporaryBatchSize > 0 && ps.eventsInBatch >= ps.temporaryBatchSize {
		ws, err := ps.flushBatchFile(ctx)
		ps.state.AddWarehouseState(ws)
		if err != nil {
			return err
		}
		err = ps.initTmpFile(ctx)
		if err != nil {
			return err
		}
	}
	ts, _ := ps.getTimestampColumnValue(processedObject)
	if ps.minTimestampInBatch == nil {
		ps.minTimestampInBatch = &ts
	} else if ts.Before(*ps.minTimestampInBatch) {
		ps.minTimestampInBatch = &ts
	}
	ps.adjustTables(ctx, targetTable, processedObject)
	err := ps.marshaller.InitSchema(ps.batchFile, nil, nil)
	if err != nil {
		return err
	}
	if ps.merge && ps.doLocalDeduplication {
		pk, err := ps.getPKValue(processedObject)
		if err != nil {
			return err
		}
		lineNumber := ps.eventsInBatch + ps.marshallerHeaderRows
		if ps.useDiscriminator {
			var newDiscriminator = processedObject.GetN(ps.discriminatorColumn)
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
	err = ps.marshaller.Marshal(processedObject)
	if err != nil {
		return errorj.Decorate(err, "failed to marshall into json file")
	}
	ps.eventsInBatch++
	return nil
}

func (ps *AbstractTransactionalSQLStream) insert(ctx context.Context, targetTable *Table, processedObject types.Object) (err error) {
	ps.adjustTables(ctx, targetTable, processedObject)
	ps.updateRepresentationTable(ps.tmpTable)
	err = ps.initTx(ctx)
	if err != nil {
		return errorj.Decorate(err, "failed to init transaction")
	}
	ps.tmpTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithoutCaching(ctx, ps.tx, ps.id, ps.tmpTable)
	if err != nil {
		return errorj.Decorate(err, "failed to ensure table")
	}
	return ps.tx.Insert(ctx, ps.tmpTable, ps.merge, processedObject)
}

func (ps *AbstractTransactionalSQLStream) adjustTables(ctx context.Context, targetTable *Table, processedObject types.Object) {
	if ps.tmpTable == nil {
		//targetTable contains desired name and primary key setup
		ps.dstTable = targetTable
		ps.tmpTable = ps.tmpTableFunc(ctx, targetTable, processedObject)
	} else {
		ps.adjustTableColumnTypes(ps.tmpTable, ps.existingTable, targetTable, processedObject)
	}
	ps.dstTable.Columns = ps.tmpTable.Columns
}

func (ps *AbstractTransactionalSQLStream) ConsumeJSON(ctx context.Context, json []byte) (state bulker.State, processedObject types.Object, err error) {
	var obj types.Object
	err = jsonorder.Unmarshal(json, &obj)
	hasTypeHints := bytes.Contains(json, []byte(types2.SqlTypePrefix))
	if err != nil {
		return ps.state, nil, fmt.Errorf("Error parsing JSON: %v", err)
	}
	return ps.consume(ctx, obj, !hasTypeHints)
}

func (ps *AbstractTransactionalSQLStream) ConsumeMap(ctx context.Context, mp map[string]any) (state bulker.State, processedObject types.Object, err error) {
	return ps.consume(ctx, types.ObjectFromMap(mp), false)
}

func (ps *AbstractTransactionalSQLStream) Consume(ctx context.Context, object types.Object) (state bulker.State, processedObject types.Object, err error) {
	return ps.consume(ctx, object, false)
}

func (ps *AbstractTransactionalSQLStream) consume(ctx context.Context, object types.Object, skipTypeHints bool) (state bulker.State, processedObject types.Object, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, nil, errors.New("stream is not active")
	}
	defer func() {
		err = ps.postConsume(err)
		state = ps.state
	}()
	if err = ps.init(ctx); err != nil {
		return
	}

	//logging.Infof("[%s] skipTypeHints: %t", ps.id, skipTypeHints)
	//type mapping, flattening => table schema
	tableForObject, processedObject, err := ps.preprocess(object, skipTypeHints)
	if err != nil {
		return
	}
	batchFile := ps.localBatchFileName != ""
	if batchFile {
		err = ps.writeToBatchFile(ctx, tableForObject, processedObject)
	} else {
		err = ps.insert(ctx, tableForObject, processedObject)
	}
	return
}

func (ps *AbstractTransactionalSQLStream) Abort(ctx context.Context) (state bulker.State) {
	if ps.state.Status != bulker.Active {
		return ps.state
	}
	if ps.merge {
		ps.batchFileLinesByPK = nil
		ps.batchFileLinesByPKDisc = nil
		ps.batchFileSkipLines = nil
	}
	if ps.tx != nil {
		if ps.tmpTable != nil {
			_ = ps.tx.Drop(ctx, ps.tmpTable, true)
		}
		_ = ps.tx.Rollback()
	}
	if ps.batchFile != nil {
		_ = ps.batchFile.Close()
		_ = os.Remove(ps.batchFile.Name())
	}
	ps.state.SuccessfulRows = 0
	ps.state.Status = bulker.Aborted
	return ps.state
}

func (ps *AbstractTransactionalSQLStream) getPKValue(object types.Object) (string, error) {
	pkColumns := ps.pkColumnsArrays
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

func (ps *AbstractTransactionalSQLStream) getTimestampColumnValue(object types.Object) (time.Time, bool) {
	if ps.timestampColumn == "" {
		return time.Time{}, false
	}
	value := object.GetN(ps.timestampColumn)
	if value == nil {
		return time.Time{}, false
	}
	timeValue, ok := value.(time.Time)
	if !ok {
		return time.Time{}, false
	}
	return timeValue, true
}
