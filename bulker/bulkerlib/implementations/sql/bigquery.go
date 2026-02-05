package sql

import (
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/bigquery"
	"cloud.google.com/go/civil"
	"github.com/hashicorp/go-multierror"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/implementations"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/types"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"google.golang.org/api/googleapi"
	"google.golang.org/api/iterator"
)

func init() {
	bulker.RegisterBulker(BigqueryBulkerTypeId, NewBigquery)
}

const (
	BigQueryAutocommitUnsupported = "BigQuery bulker doesn't support auto commit mode as not efficient"
	BigqueryBulkerTypeId          = "bigquery"

	bigqueryInsertFromSelectTemplate = "INSERT INTO %s(%s) SELECT %s FROM %s"
	bigqueryMergeTemplate            = "MERGE INTO %s T USING %s S ON %s WHEN MATCHED THEN UPDATE SET %s WHEN NOT MATCHED THEN INSERT (%s) VALUES (%s)"
	bigqueryDeleteTemplate           = "DELETE FROM %s WHERE %s"
	bigqueryUpdateTemplate           = "UPDATE %s SET %s WHERE %s"

	bigqueryTruncateTemplate = "TRUNCATE TABLE %s"
	bigquerySelectTemplate   = "SELECT %s FROM %s%s%s"

	bigqueryPKHashLabel = "jitsu_pk_hash"
	bigqueryPKNameLabel = "jitsu_pk_name"

	bigqueryRowsLimitPerInsertOperation = 500
)

var (
	bigqueryReservedWords    = []string{"all", "and", "any", "array", "as", "asc", "assert_rows_modified", "at", "between", "by", "case", "cast", "collate", "contains", "create", "cross", "cube", "current", "current_time", "default", "define", "desc", "distinct", "else", "end", "enum", "escape", "except", "exclude", "exists", "extract", "false", "fetch", "following", "for", "from", "full", "group", "grouping", "groups", "hash", "having", "if", "ignore", "in", "inner", "intersect", "interval", "into", "is", "join", "lateral", "left", "like", "limit", "lookup", "merge", "natural", "new", "no", "not", "null", "nulls", "of", "on", "or", "order", "outer", "over", "partition", "preceding", "proto", "qualify", "range", "recursive", "respect", "right", "rollup", "rows", "select", "set", "some", "struct", "tablesample", "then", "to", "treat", "true", "unbounded", "union", "unnest", "using", "when", "where", "window", "with", "within"}
	bigqueryReservedWordsSet = types.NewSet(bigqueryReservedWords...)
	bigqueryReservedPrefixes = [...]string{"_table_", "_file_", "_partition", "_row_timestamp", "__root__", "_colidentifier"}

	bigqueryColumnUnsupportedCharacters = regexp.MustCompile(`[^0-9A-Za-z_]`)

	//SchemaToBigQueryString is mapping between JSON types and BigQuery types
	bigqueryTypes = map[types2.DataType][]string{
		types2.STRING:    {string(bigquery.StringFieldType)},
		types2.INT64:     {string(bigquery.IntegerFieldType)},
		types2.FLOAT64:   {string(bigquery.FloatFieldType)},
		types2.TIMESTAMP: {string(bigquery.TimestampFieldType), string(bigquery.DateFieldType), string(bigquery.DateTimeFieldType)},
		types2.BOOL:      {string(bigquery.BooleanFieldType)},
		types2.JSON:      {string(bigquery.JSONFieldType)},
		types2.UNKNOWN:   {string(bigquery.StringFieldType)},
	}
	bigqueryTypeMapping        map[types2.DataType]string
	bigqueryReverseTypeMapping map[string]types2.DataType

	bigqueryAvroTypes = map[string]any{
		"STRING":     []any{"null", map[string]string{"type": "string", "sqlType": "STRING"}},
		"BYTES":      []any{"null", map[string]string{"type": "bytes", "sqlType": "BYTES"}},
		"INTEGER":    []any{"null", map[string]string{"type": "long", "sqlType": "INTEGER"}},
		"INT64":      []any{"null", map[string]string{"type": "long", "sqlType": "INT64"}},
		"FLOAT":      []any{"null", map[string]string{"type": "double", "sqlType": "FLOAT"}},
		"FLOAT64":    []any{"null", map[string]string{"type": "double", "sqlType": "FLOAT64"}},
		"DECIMAL":    []any{"null", map[string]string{"type": "double", "sqlType": "DECIMAL"}},
		"BIGDECIMAL": []any{"null", map[string]string{"type": "double", "sqlType": "BIGDECIMAL"}},
		"BOOLEAN":    []any{"null", map[string]string{"type": "boolean", "sqlType": "BOOLEAN"}},
		"BOOL":       []any{"null", map[string]string{"type": "boolean", "sqlType": "BOOL"}},
		"TIMESTAMP":  []any{"null", map[string]string{"logicalType": "timestamp-millis", "type": "long"}},
		"RECORD":     []any{"null", map[string]string{"type": "string", "sqlType": "RECORD"}},
		"STRUCT":     []any{"null", map[string]string{"type": "string", "sqlType": "STRUCT"}},
		"DATE":       []any{"null", map[string]string{"logicalType": "date", "type": "int"}},
		"TIME":       []any{"null", map[string]string{"logicalType": "time-millis", "type": "int"}},
		"DATETIME":   []any{"null", map[string]string{"logicalType": "timestamp-millis", "type": "long"}},
		"NUMERIC":    []any{"null", map[string]string{"type": "double", "sqlType": "NUMERIC"}},
		"GEOGRAPHY":  []any{"null", map[string]string{"type": "string", "sqlType": "GEOGRAPHY"}},
		"BIGNUMERIC": []any{"null", map[string]string{"type": "long", "sqlType": "BIGNUMERIC"}},
		"INTERVAL":   []any{"null", map[string]string{"type": "int", "sqlType": "INTERVAL"}},
		"JSON":       []any{"null", map[string]string{"type": "string", "sqlType": "JSON"}},
		"RANGE":      []any{"null", map[string]string{"type": "string", "sqlType": "RANGE"}},
	}
)

func init() {
	bigqueryTypeMapping = make(map[types2.DataType]string, len(bigqueryTypes))
	bigqueryReverseTypeMapping = make(map[string]types2.DataType, len(bigqueryTypes)+3)
	for dataType, bqTypes := range bigqueryTypes {
		for i, bqType := range bqTypes {
			if i == 0 {
				bigqueryTypeMapping[dataType] = bqType
			}
			if dataType != types2.UNKNOWN {
				bigqueryReverseTypeMapping[bqType] = dataType
			}
		}
	}
}

// BigQuery adapter for creating,patching (schema or table), inserting and copying data from gcs to BigQuery
type BigQuery struct {
	appbase.Service
	client      *bigquery.Client
	config      *implementations.GoogleConfig
	queryLogger *logging.QueryLogger
	tableHelper TableHelper
}

// NewBigquery return configured BigQuery bulker.Bulker instance
func NewBigquery(bulkerConfig bulker.Config) (bulker.Bulker, error) {
	config := &implementations.GoogleConfig{}
	if err := utils.ParseObject(bulkerConfig.DestinationConfig, config); err != nil {
		return nil, fmt.Errorf("failed to parse destination config: %v", err)
	}
	var err error
	err = config.Validate()
	if err != nil {
		return nil, fmt.Errorf("failed to validate config: %v", err)
	}
	var client *bigquery.Client
	ctx := context.Background()
	if config.Credentials == nil {
		client, err = bigquery.NewClient(ctx, config.Project)
	} else {
		client, err = bigquery.NewClient(ctx, config.Project, config.Credentials)
	}

	if err != nil {
		err = fmt.Errorf("error creating BigQuery client: %v", err)
	}
	var queryLogger *logging.QueryLogger
	if bulkerConfig.LogLevel == bulker.Verbose {
		queryLogger = logging.NewQueryLogger(bulkerConfig.Id, os.Stderr, os.Stderr)
	}
	b := &BigQuery{
		Service: appbase.NewServiceBase(bulkerConfig.Id),
		client:  client, config: config, queryLogger: queryLogger}
	b.tableHelper = NewTableHelper(BigqueryBulkerTypeId, 1024, '`')
	b.tableHelper.columnNameFunc = columnNameFunc
	b.tableHelper.tableNameFunc = tableNameFunc
	return b, err
}

func (bq *BigQuery) CreateStream(id, tableName string, mode bulker.BulkMode, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	bq.validateOptions(streamOptions)
	streamOptions = append(streamOptions, withLocalBatchFile(fmt.Sprintf("bulker_%s", utils.SanitizeString(id))))
	switch mode {
	case bulker.Stream:
		return nil, errors.New(BigQueryAutocommitUnsupported)
		//return newAutoCommitStream(id, bq, tableName, streamOptions...)
	case bulker.Batch:
		return newTransactionalStream(id, bq, tableName, streamOptions...)
	case bulker.ReplaceTable:
		return newReplaceTableStream(id, bq, tableName, streamOptions...)
	case bulker.ReplacePartition:
		return newReplacePartitionStream(id, bq, tableName, streamOptions...)
	}
	return nil, fmt.Errorf("unsupported bulk mode: %s", mode)
}

func (bq *BigQuery) GetBatchFileFormat() types2.FileFormat {
	return types2.FileFormatNDJSON
}

func (bq *BigQuery) GetBatchFileCompression() types2.FileCompression {
	return types2.FileCompressionGZIP
}

func (bq *BigQuery) StringifyObjects() bool {
	return false
}

func (bq *BigQuery) validateOptions(streamOptions []bulker.StreamOption) error {
	options := &bulker.StreamOptions{}
	for _, option := range streamOptions {
		options.Add(option)
	}
	return nil
}

func (bq *BigQuery) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (state bulker.WarehouseState, err error) {
	namespace := bq.NamespaceName(targetTable.Namespace)
	if mergeWindow <= 0 {
		defer func() {
			if err != nil {
				err = errorj.CopyError.Wrap(err, "failed to run CopyTables").
					WithProperty(errorj.DBInfo, &types2.ErrorPayload{
						Dataset: bq.config.Dataset,
						Bucket:  bq.config.Bucket,
						Project: bq.config.Project,
						Table:   targetTable.Name,
					})
			}
		}()
		dataset := bq.client.Dataset(namespace)
		copier := dataset.Table(targetTable.Name).CopierFrom(dataset.Table(sourceTable.Name))
		copier.WriteDisposition = bigquery.WriteAppend
		copier.CreateDisposition = bigquery.CreateIfNeeded
		_, state, err = bq.RunJob(ctx, copier, fmt.Sprintf("copy data from %s to %s", bq.fullTableName(sourceTable.Namespace, sourceTable.Name), bq.fullTableName(targetTable.Namespace, targetTable.Name)))
		state.Name = "copy"
		if err != nil {
			// try to insert from select as a fallback
			quotedColumns := sourceTable.MappedColumnNames(bq.quotedColumnName)
			columnsString := strings.Join(quotedColumns, ",")
			insertFromSelectStatement := fmt.Sprintf(bigqueryInsertFromSelectTemplate, bq.fullTableName(targetTable.Namespace, targetTable.Name), columnsString, columnsString, bq.fullTableName(sourceTable.Namespace, sourceTable.Name))
			query := bq.client.Query(insertFromSelectStatement)
			_, state2, err := bq.RunJob(ctx, query, fmt.Sprintf("copy data from %s to %s", bq.fullTableName(sourceTable.Namespace, sourceTable.Name), bq.fullTableName(targetTable.Namespace, targetTable.Name)))
			state2.Name = "insert_from_select"
			state.Merge(state2)
			return state, err
		} else {
			return state, nil
		}
	} else {
		defer func() {
			if err != nil {
				err = errorj.BulkMergeError.Wrap(err, "failed to run merge").
					WithProperty(errorj.DBInfo, &types2.ErrorPayload{
						Dataset: namespace,
						Bucket:  bq.config.Bucket,
						Project: bq.config.Project,
						Table:   targetTable.Name,
					})
			}
		}()
		quotedColumns := sourceTable.MappedColumnNames(bq.quotedColumnName)
		columnsString := strings.Join(quotedColumns, ",")
		updateSet := make([]string, len(quotedColumns))
		for i, name := range quotedColumns {
			updateSet[i] = fmt.Sprintf("T.%s = S.%s", name, name)
		}
		var joinConditions []string
		targetTable.PKFields.ForEach(func(pkField string) {
			joinConditions = append(joinConditions, fmt.Sprintf("T.%s = S.%s", bq.quotedColumnName(pkField), bq.quotedColumnName(pkField)))
		})
		if targetTable.TimestampColumn != "" {
			//month before
			monthBefore := timestamp.Now().Add(time.Duration(mergeWindow) * -24 * time.Hour).Format("2006-01-02")
			joinConditions = append(joinConditions, fmt.Sprintf("T.%s >= '%s'", bq.quotedColumnName(targetTable.TimestampColumn), monthBefore))
		}
		insertFromSelectStatement := fmt.Sprintf(bigqueryMergeTemplate, bq.fullTableName(targetTable.Namespace, targetTable.Name), bq.fullTableName(sourceTable.Namespace, sourceTable.Name),
			strings.Join(joinConditions, " AND "), strings.Join(updateSet, ", "), columnsString, columnsString)

		query := bq.client.Query(insertFromSelectStatement)
		_, state, err = bq.RunJob(ctx, query, fmt.Sprintf("copy data from '%s' to '%s'", sourceTable.Name, targetTable.Name))
		state.Name = "merge"
		return state, err
	}
}

func (bq *BigQuery) Ping(ctx context.Context) error {
	if bq.client == nil {
		ctx := context.Background()
		var err error
		if bq.config.Credentials == nil {
			bq.client, err = bigquery.NewClient(ctx, bq.config.Project)
		} else {
			bq.client, err = bigquery.NewClient(ctx, bq.config.Project, bq.config.Credentials)
		}
		return err
	}
	_, err := bq.client.Query("SELECT 1;").Read(context.Background())
	if err != nil {
		if bq.config.Credentials == nil {
			bq.client, err = bigquery.NewClient(ctx, bq.config.Project)
		} else {
			bq.client, err = bigquery.NewClient(ctx, bq.config.Project, bq.config.Credentials)
		}
	}
	return err
}

// GetTableSchema return google BigQuery table (name,columns) representation wrapped in Table struct
func (bq *BigQuery) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	tableName = bq.TableName(tableName)
	namespace = bq.NamespaceName(namespace)
	table := &Table{Name: tableName, Namespace: namespace, Columns: NewColumns(0), PKFields: jsonorder.NewOrderedSet[string]()}
	bqTable := bq.client.Dataset(namespace).Table(tableName)

	meta, err := bqTable.Metadata(ctx)
	if err != nil {
		if isNotFoundErr(err) {
			return table, nil
		}

		return nil, errorj.GetTableError.Wrap(err, "failed to get table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset: namespace,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}
	for _, field := range meta.Schema {
		dt, _ := bq.GetDataType(string(field.Type))
		table.Columns.Set(field.Name, types2.SQLColumn{Type: string(field.Type), DataType: dt})
	}
	jitsuPKName := meta.Labels[bigqueryPKNameLabel]
	jitsuPKHash := meta.Labels[bigqueryPKHashLabel]

	tableConstraints := meta.TableConstraints
	if tableConstraints != nil && tableConstraints.PrimaryKey != nil {
		table.PKFields.PutAll(tableConstraints.PrimaryKey.Columns)
		if table.PKFields.Hash() == jitsuPKHash {
			// PK was not changed since Jitsu managed this table
			table.PrimaryKeyName = jitsuPKName
		}
	}
	if meta.TimePartitioning != nil {
		table.Partition.Field = meta.TimePartitioning.Field
		switch meta.TimePartitioning.Type {
		case bigquery.HourPartitioningType:
			table.Partition.Granularity = HOUR
		case bigquery.DayPartitioningType:
			table.Partition.Granularity = DAY
		case bigquery.MonthPartitioningType:
			table.Partition.Granularity = MONTH
		case bigquery.YearPartitioningType:
			table.Partition.Granularity = YEAR
		}
		table.TimestampColumn = meta.TimePartitioning.Field
	}

	return table, nil
}

// CreateTable creates google BigQuery table from Table
func (bq *BigQuery) CreateTable(ctx context.Context, table *Table) (t *Table, err error) {
	err = bq.createDatasetIfNotExists(ctx, table.Namespace)
	if err != nil {
		return nil, err
	}
	tableName := bq.TableName(table.Name)
	namespace := bq.NamespaceName(table.Namespace)
	bqTable := bq.client.Dataset(namespace).Table(tableName)

	_, err = bqTable.Metadata(ctx)
	if err == nil {
		bq.Infof("BigQuery table %s already exists", tableName)
		return table, nil
	}

	if !isNotFoundErr(err) {
		return nil, errorj.GetTableError.Wrap(err, "failed to get table metadata").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset: namespace,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	bqSchema := bigquery.Schema{}
	for el := table.Columns.Front(); el != nil; el = el.Next() {
		columnName := el.Key
		column := el.Value
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.GetDDLType()))
		bqSchema = append(bqSchema, &bigquery.FieldSchema{Name: bq.ColumnName(columnName), Type: bigQueryType})
	}
	var tableConstraints *bigquery.TableConstraints
	var labels map[string]string
	if table.PKFields.Size() > 0 {
		tableConstraints = &bigquery.TableConstraints{
			PrimaryKey: &bigquery.PrimaryKey{
				Columns: table.GetPKFields(),
			},
		}
		if table.PrimaryKeyName == "" {
			table.PrimaryKeyName = BuildConstraintName(table.Name)
		}
		labels = map[string]string{
			bigqueryPKHashLabel: table.PKFields.Hash(),
			bigqueryPKNameLabel: table.PrimaryKeyName,
		}
	}
	tableMetaData := bigquery.TableMetadata{Name: tableName, Schema: bqSchema, TableConstraints: tableConstraints, Labels: labels}
	if table.Partition.Field == "" && table.TimestampColumn != "" {
		// partition by timestamp column
		table = table.Clone()
		table.Partition.Field = table.TimestampColumn
		table.Partition.Granularity = DAY
	}
	if table.Partition.Field != "" && table.Partition.Granularity != ALL {
		var partitioningType bigquery.TimePartitioningType
		switch table.Partition.Granularity {
		case DAY, WEEK:
			partitioningType = bigquery.DayPartitioningType
		case MONTH, QUARTER:
			partitioningType = bigquery.MonthPartitioningType
		case YEAR:
			partitioningType = bigquery.YearPartitioningType
		}
		tableMetaData.TimePartitioning = &bigquery.TimePartitioning{Field: table.Partition.Field, Type: partitioningType}
	}
	if table.Temporary {
		tableMetaData.ExpirationTime = time.Now().Add(time.Hour)
	}
	bq.logQuery(fmt.Sprintf("CREATE table %s with schema: ", bq.fullTableName(table.Namespace, table.Name)), tableMetaData, nil)
	if err := bqTable.Create(ctx, &tableMetaData); err != nil {
		schemaJson, _ := bqSchema.ToJSONFields()
		return nil, errorj.GetTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset:   namespace,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     tableName,
				Statement: string(schemaJson),
			})
	}

	return table, nil
}

func (bq *BigQuery) createDatasetIfNotExists(ctx context.Context, dataset string) error {
	if dataset == "" {
		return nil
	}
	dataset = bq.NamespaceName(dataset)
	if dataset == "" {
		return nil
	}
	bqDataset := bq.client.Dataset(dataset)
	if _, err := bqDataset.Metadata(ctx); err != nil {
		if isNotFoundErr(err) {
			datasetMetadata := &bigquery.DatasetMetadata{Name: dataset}
			bq.logQuery("CREATE dataset: ", datasetMetadata, nil)
			if err := bqDataset.Create(ctx, datasetMetadata); err != nil {
				return errorj.CreateSchemaError.Wrap(err, "failed to create dataset").
					WithProperty(errorj.DBInfo, &types2.ErrorPayload{
						Dataset: dataset,
					})
			}
		} else {
			return errorj.CreateSchemaError.Wrap(err, "failed to get dataset metadata").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset: dataset,
				})
		}
	}

	return nil
}

// InitDatabase creates google BigQuery Dataset if doesn't exist
func (bq *BigQuery) InitDatabase(ctx context.Context) error {
	return bq.createDatasetIfNotExists(ctx, bq.config.Dataset)
}

// PatchTableSchema adds Table columns to google BigQuery table
func (bq *BigQuery) PatchTableSchema(ctx context.Context, patchSchema *Table) (*Table, error) {
	namespace := bq.NamespaceName(patchSchema.Namespace)
	bqTable := bq.client.Dataset(namespace).Table(patchSchema.Name)
	metadata, err := bqTable.Metadata(ctx)
	if err != nil {
		return nil, errorj.PatchTableError.Wrap(err, "failed to get table metadata").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset: namespace,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   patchSchema.Name,
			})
	}
	//patch primary keys - delete old
	if patchSchema.DeletePrimaryKeyNamed != "" {
		delete(metadata.Labels, bigqueryPKHashLabel)
		delete(metadata.Labels, bigqueryPKNameLabel)
		if metadata.TableConstraints != nil {
			metadata.TableConstraints.PrimaryKey = &bigquery.PrimaryKey{}
		}
	}

	//patch primary keys - create new
	if patchSchema.PKFields.Size() > 0 {
		if metadata.Labels == nil {
			metadata.Labels = map[string]string{}
		}
		if patchSchema.PrimaryKeyName == "" {
			patchSchema.PrimaryKeyName = BuildConstraintName(patchSchema.Name)
		}
		metadata.Labels[bigqueryPKHashLabel] = patchSchema.PKFields.Hash()
		metadata.Labels[bigqueryPKNameLabel] = patchSchema.PrimaryKeyName
		if metadata.TableConstraints == nil {
			metadata.TableConstraints = &bigquery.TableConstraints{}
		}
		metadata.TableConstraints.PrimaryKey = &bigquery.PrimaryKey{
			Columns: patchSchema.GetPKFields(),
		}
	}
	for el := patchSchema.Columns.Front(); el != nil; el = el.Next() {
		columnName := el.Key
		column := el.Value
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.GetDDLType()))
		metadata.Schema = append(metadata.Schema, &bigquery.FieldSchema{Name: bq.ColumnName(columnName), Type: bigQueryType})
	}
	updateReq := bigquery.TableMetadataToUpdate{Schema: metadata.Schema}
	bq.logQuery("PATCH update request: ", updateReq, nil)
	if _, err := bqTable.Update(ctx, updateReq, metadata.ETag); err != nil {
		schemaJson, _ := metadata.Schema.ToJSONFields()
		return nil, errorj.PatchTableError.Wrap(err, "failed to patch table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset:   namespace,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     patchSchema.Name,
				Statement: string(schemaJson),
			})
	}

	return patchSchema, nil
}

func (bq *BigQuery) DeletePartition(ctx context.Context, namespace, tableName string, datePartiton *DatePartition) error {
	tableName = bq.TableName(tableName)
	namespace = bq.NamespaceName(namespace)
	partitions := GranularityToPartitionIds(datePartiton.Granularity, datePartiton.Value)
	for _, partition := range partitions {
		bq.logQuery("DELETE partition "+partition+" in table"+tableName, "", nil)
		bq.Infof("Deletion partition %s in table %s", partition, tableName)
		if err := bq.client.Dataset(namespace).Table(tableName + "$" + partition).Delete(ctx); err != nil {
			gerr, ok := err.(*googleapi.Error)
			if ok && gerr.Code == 404 {
				bq.Infof("Partition %s$%s was not found", tableName, partition)
				continue
			}
			return errorj.DeleteFromTableError.Wrap(err, "failed to delete partition").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset:   namespace,
					Bucket:    bq.config.Bucket,
					Project:   bq.config.Project,
					Table:     tableName,
					Partition: partition,
				})
		}

	}
	return nil
}

func GranularityToPartitionIds(g Granularity, t time.Time) []string {
	t = g.Lower(t)
	switch g {
	case HOUR:
		return []string{t.Format("2006010215")}
	case DAY:
		return []string{t.Format("20060102")}
	case WEEK:
		week := make([]string, 0, 7)
		for i := 0; i < 7; i++ {
			week = append(week, t.AddDate(0, 0, i).Format("20060102"))
		}
		return week
	case MONTH:
		return []string{t.Format("200601")}
	case QUARTER:
		quarter := make([]string, 0, 3)
		for i := 0; i < 3; i++ {
			quarter = append(quarter, t.AddDate(0, i, 0).Format("200601"))
		}
		return quarter
	case YEAR:
		return []string{t.Format("2006")}
	default:
		logging.SystemErrorf("Granularity %s is not mapped to any partition time unit:.", g)
		return []string{}
	}
}

func (bq *BigQuery) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) (err error) {
	namespace := bq.NamespaceName(table.Namespace)
	inserter := bq.client.Dataset(namespace).Table(table.Name).Inserter()
	bq.logQuery(fmt.Sprintf("Inserting [%d] values to table %s using BigQuery Streaming API with chunks [%d]: ", len(objects), table.Name, bigqueryRowsLimitPerInsertOperation), objects, nil)

	items := make([]*BQItem, 0, bigqueryRowsLimitPerInsertOperation)
	operation := 0
	operations := int(math.Max(1, float64(len(objects))/float64(bigqueryRowsLimitPerInsertOperation)))
	for _, object := range objects {
		if len(items) > bigqueryRowsLimitPerInsertOperation {
			operation++
			if err := bq.insertItems(ctx, inserter, items); err != nil {
				return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute middle insert %d of %d in batch", operation, operations).
					WithProperty(errorj.DBInfo, &types2.ErrorPayload{
						Dataset: namespace,
						Bucket:  bq.config.Bucket,
						Project: bq.config.Project,
						Table:   table.Name,
					})
			}

			items = make([]*BQItem, 0, bigqueryRowsLimitPerInsertOperation)
		}

		items = append(items, &BQItem{values: types2.ObjectToMap(object)})
	}

	if len(items) > 0 {
		operation++
		if err := bq.insertItems(ctx, inserter, items); err != nil {
			return errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute last insert %d of %d in batch", operation, operations).
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset: bq.config.Dataset,
					Bucket:  bq.config.Bucket,
					Project: bq.config.Project,
					Table:   table.Name,
				})
		}
	}

	return nil
}

func (bq *BigQuery) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error) {
	tableName := bq.TableName(targetTable.Name)
	dataset := bq.NamespaceName(targetTable.Namespace)
	defer func() {
		if err != nil {
			err = errorj.ExecuteInsertInBatchError.Wrap(err, "failed to execute middle insert batch").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset: dataset,
					Bucket:  bq.config.Bucket,
					Project: bq.config.Project,
					Table:   tableName,
				})
		}
	}()
	//f, err := os.ReadFile(loadSource.Path)
	//bq.Infof("FILE: %s", f)

	file, err := os.Open(loadSource.Path)
	if err != nil {
		return state, err
	}
	defer func() {
		_ = file.Close()
	}()
	bqTable := bq.client.Dataset(dataset).Table(tableName)
	meta, err := bqTable.Metadata(ctx)
	if err != nil {
		return state, err
	}

	if loadSource.Format == types2.FileFormatCSV {
		//sort meta schema field order to match csv file column order
		mp := make(map[string]*bigquery.FieldSchema, len(meta.Schema))
		for _, field := range meta.Schema {
			mp[field.Name] = field
		}
		err = targetTable.Columns.ForEachIndexedE(func(i int, field string, _ types2.SQLColumn) error {
			if _, ok := mp[field]; !ok {
				return fmt.Errorf("field %s is not in table schema", field)
			}
			meta.Schema[i] = mp[field]
			return nil
		})
		if err != nil {
			return state, err
		}
	}

	source := bigquery.NewReaderSource(file)
	source.Schema = meta.Schema

	switch loadSource.Format {
	case types2.FileFormatCSV:
		source.SourceFormat = bigquery.CSV
		source.SkipLeadingRows = 1
		source.AllowQuotedNewlines = true
		source.PreserveASCIIControlCharacters = true
		source.CSVOptions.NullMarker = "\\N"
	case types2.FileFormatNDJSON:
		source.SourceFormat = bigquery.JSON
	case types2.FileFormatAVRO:
		source.SourceFormat = bigquery.Avro
		source.AvroOptions = &bigquery.AvroOptions{
			UseAvroLogicalTypes: true,
		}
	}
	loader := bq.client.Dataset(dataset).Table(tableName).LoaderFrom(source)
	loader.CreateDisposition = bigquery.CreateIfNeeded
	loader.WriteDisposition = bigquery.WriteAppend
	_, state, err = bq.RunJob(ctx, loader, fmt.Sprintf("load into table %s", bq.fullTableName(dataset, tableName)))
	state.Name = "load"
	return state, err
}

// DropTable drops table from BigQuery
func (bq *BigQuery) DropTable(ctx context.Context, namespace string, tableName string, ifExists bool) error {
	tableName = bq.TableName(tableName)
	dataset := bq.NamespaceName(namespace)
	bq.logQuery(fmt.Sprintf("DROP table %s if exists: %t", bq.fullTableName(dataset, tableName), ifExists), nil, nil)

	bqTable := bq.client.Dataset(dataset).Table(tableName)
	_, err := bqTable.Metadata(ctx)
	gerr, ok := err.(*googleapi.Error)
	if ok && gerr.Code == 404 && ifExists {
		return nil
	}
	if err := bqTable.Delete(ctx); err != nil {
		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset: dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	return nil
}

func (bq *BigQuery) Drop(ctx context.Context, table *Table, ifExists bool) error {
	return bq.DropTable(ctx, table.Namespace, table.Name, ifExists)
}

func (bq *BigQuery) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) (err error) {
	targetTableName = bq.TableName(targetTableName)
	namespace := bq.NamespaceName(replacementTable.Namespace)
	replacementTableName := bq.TableName(replacementTable.Name)
	defer func() {
		if err != nil {
			err = errorj.CopyError.Wrap(err, "failed to replace table").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset: bq.config.Dataset,
					Bucket:  bq.config.Bucket,
					Project: bq.config.Project,
					Table:   targetTableName,
				})
		}
	}()
	dataset := bq.client.Dataset(namespace)
	copier := dataset.Table(targetTableName).CopierFrom(dataset.Table(replacementTableName))
	copier.WriteDisposition = bigquery.WriteTruncate
	copier.CreateDisposition = bigquery.CreateIfNeeded
	_, _, err = bq.RunJob(ctx, copier, fmt.Sprintf("replace table '%s' with '%s'", targetTableName, replacementTableName))
	if err != nil {
		return err
	}
	if dropOldTable {
		return bq.DropTable(ctx, replacementTable.Namespace, replacementTableName, false)
	} else {
		return nil
	}
}

// TruncateTable deletes all records in tableName table
func (bq *BigQuery) TruncateTable(ctx context.Context, namespace string, tableName string) error {
	tableName = bq.TableName(tableName)
	query := fmt.Sprintf(bigqueryTruncateTemplate, bq.fullTableName(namespace, tableName))
	bq.logQuery(query, nil, nil)
	if _, err := bq.client.Query(query).Read(ctx); err != nil {
		//extraText := ""
		//if strings.Contains(err.Error(), "Not found") {
		//	extraText = ": " + ErrTableNotExist.Error()
		//}
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &types2.ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}
	//TODO: temporary workaround for "404: Table is truncated" error until #958 is done
	time.Sleep(time.Minute)
	return nil
}

func (bq *BigQuery) insertItems(ctx context.Context, inserter *bigquery.Inserter, items []*BQItem) error {
	if err := inserter.Put(ctx, items); err != nil {
		var multiErr error
		if putMultiError, ok := err.(bigquery.PutMultiError); ok {
			for _, errUnit := range putMultiError {
				multiErr = multierror.Append(multiErr, errors.New(errUnit.Error()))
			}
		} else {
			multiErr = err
		}

		return multiErr
	}

	return nil
}

func (bq *BigQuery) toDeleteQuery(conditions *WhenConditions) string {
	var queryConditions []string

	for _, condition := range conditions.Conditions {
		conditionString := fmt.Sprintf("%v %v %q", condition.Field, condition.Clause, condition.Value)
		queryConditions = append(queryConditions, conditionString)
	}

	return strings.Join(queryConditions, " "+conditions.JoinCondition+" ")
}

func (bq *BigQuery) logQuery(messageTemplate string, entity any, err error) {
	if bq.queryLogger != nil {
		entityString := ""
		if entity != nil {
			entityJSON, err := jsoniter.Marshal(entity)
			if err != nil {
				entityString = fmt.Sprintf("[failed to marshal query entity: %v]", err)
				bq.Warnf("Failed to serialize entity for logging: %s", fmt.Sprint(entity))
			} else {
				entityString = string(entityJSON)
			}
		}
		bq.queryLogger.LogQuery(messageTemplate+entityString, err)
	}
}

func (bq *BigQuery) Close() error {
	if bq.client != nil {
		return bq.client.Close()
	}
	return nil
}

// Return true if google err is 404
func isNotFoundErr(err error) bool {
	e, ok := err.(*googleapi.Error)
	return ok && e.Code == http.StatusNotFound
}

// BQItem struct for streaming inserts to BigQuery
type BQItem struct {
	values map[string]any
}

func (bqi *BQItem) Save() (row map[string]bigquery.Value, insertID string, err error) {
	row = map[string]bigquery.Value{}

	for k, v := range bqi.values {
		row[k] = v
	}

	return
}

func (bq *BigQuery) Update(ctx context.Context, namespace, tableName string, object types2.Object, whenConditions *WhenConditions) (err error) {
	tableName = bq.TableName(tableName)
	updateCondition, updateValues := bq.toWhenConditions(whenConditions)

	count := object.Len()
	columns := make([]string, count)
	values := make([]bigquery.QueryParameter, count+len(updateValues), count+len(updateValues))
	object.ForEachIndexed(func(i int, name string, value any) {
		columns[i] = bq.quotedColumnName(name) + "= @" + name
		values[i] = bigquery.QueryParameter{Name: name, Value: value}
	})
	i := len(values)
	for a := 0; a < len(updateValues); a++ {
		values[i+a] = updateValues[a]
	}
	updateQuery := fmt.Sprintf(bigqueryUpdateTemplate, bq.fullTableName(namespace, tableName), strings.Join(columns, ", "), updateCondition)
	defer func() {
		v := make([]any, len(values))
		for i, value := range values {
			v[i] = value.Value
		}
		if err != nil {
			err = errorj.UpdateError.Wrap(err, "failed execute update").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset:   bq.config.Dataset,
					Table:     tableName,
					Statement: updateQuery,
					Values:    v,
				})
		}
	}()

	query := bq.client.Query(updateQuery)
	query.Parameters = values
	_, _, err = bq.RunJob(ctx, query, fmt.Sprintf("update table '%s'", tableName))
	return err
}

func (bq *BigQuery) Select(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error) {
	return bq.selectFrom(ctx, namespace, tableName, "*", whenConditions, orderBy)
}
func (bq *BigQuery) selectFrom(ctx context.Context, namespace, tableName string, selectExpression string, whenConditions *WhenConditions, orderBy []string) (res []map[string]any, err error) {
	tableName = bq.TableName(tableName)
	whenCondition, values := bq.toWhenConditions(whenConditions)
	if whenCondition != "" {
		whenCondition = " WHERE " + whenCondition
	}
	orderByClause := ""
	if len(orderBy) > 0 {
		quotedOrderByColumns := make([]string, len(orderBy))
		for i, col := range orderBy {
			quotedOrderByColumns[i] = fmt.Sprintf("%s asc", bq.quotedColumnName(col))
		}
		orderByClause = " ORDER BY " + strings.Join(quotedOrderByColumns, ", ")
	}
	selectQuery := fmt.Sprintf(bigquerySelectTemplate, selectExpression, bq.fullTableName(namespace, tableName), whenCondition, orderByClause)

	defer func() {
		v := make([]any, len(values))
		for i, value := range values {
			v[i] = value.Value
		}
		if err != nil {
			err = errorj.SelectFromTableError.Wrap(err, "failed execute select").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset:   bq.config.Dataset,
					Table:     tableName,
					Statement: selectQuery,
					Values:    v,
				})
		}
	}()

	query := bq.client.Query(selectQuery)
	query.Parameters = values
	job, _, err := bq.RunJob(ctx, query, fmt.Sprintf("select from table %s", bq.fullTableName(namespace, tableName)))
	if err != nil {
		return nil, err
	}
	it, err := job.Read(ctx)
	if err != nil {
		return nil, err
	}
	var result []map[string]any
	for {
		var row = map[string]bigquery.Value{}
		err := it.Next(&row)
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, err
		}
		var resRow = map[string]any{}
		for k, v := range row {
			switch i := v.(type) {
			case civil.Date:
				v = i.In(time.UTC)
			case int64:
				v = int(i)
			}
			resRow[k] = v
		}
		result = append(result, resRow)
	}
	return result, nil
}

func (bq *BigQuery) Count(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions) (int, error) {
	res, err := bq.selectFrom(ctx, namespace, tableName, "count(*) as jitsu_count", whenConditions, nil)
	if err != nil {
		return -1, err
	}
	if len(res) == 0 {
		return -1, fmt.Errorf("select count * gave no result")
	}
	return strconv.Atoi(fmt.Sprint(res[0]["jitsu_count"]))
}

func (bq *BigQuery) toWhenConditions(conditions *WhenConditions) (string, []bigquery.QueryParameter) {
	if conditions == nil {
		return "", []bigquery.QueryParameter{}
	}
	var queryConditions []string
	var values []bigquery.QueryParameter

	for _, condition := range conditions.Conditions {
		switch strings.ToLower(condition.Clause) {
		case "is null":
		case "is not null":
			queryConditions = append(queryConditions, bq.quotedColumnName(condition.Field)+" "+condition.Clause)
		default:
			queryConditions = append(queryConditions, bq.quotedColumnName(condition.Field)+" "+condition.Clause+" @when_"+condition.Field)
			v, _ := types2.ReformatValue(condition.Value)
			values = append(values, bigquery.QueryParameter{Name: "when_" + condition.Field, Value: v})
		}
	}

	return strings.Join(queryConditions, " "+conditions.JoinCondition+" "), values
}
func (bq *BigQuery) Delete(ctx context.Context, namespace string, tableName string, deleteConditions *WhenConditions) (err error) {
	tableName = bq.TableName(tableName)
	whenCondition, values := bq.toWhenConditions(deleteConditions)
	if len(whenCondition) == 0 {
		return errors.New("delete conditions are empty")
	}
	deleteQuery := fmt.Sprintf(bigqueryDeleteTemplate, bq.fullTableName(namespace, tableName), whenCondition)
	defer func() {
		v := make([]any, len(values))
		for i, value := range values {
			v[i] = value.Value
		}
		if err != nil {
			err = errorj.DeleteFromTableError.Wrap(err, "failed execute delete").
				WithProperty(errorj.DBInfo, &types2.ErrorPayload{
					Dataset:   bq.config.Dataset,
					Table:     tableName,
					Statement: deleteQuery,
					Values:    v,
				})
		}
	}()
	query := bq.client.Query(deleteQuery)
	query.Parameters = values
	_, _, err = bq.RunJob(ctx, query, fmt.Sprintf("delete from table '%s'", tableName))
	return err
}
func (bq *BigQuery) Type() string {
	return BigqueryBulkerTypeId
}

func (bq *BigQuery) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return &TxSQLAdapter{sqlAdapter: bq, tx: NewDummyTxWrapper(bq.Type())}, nil
}

func (bq *BigQuery) fullTableName(namespace, tableName string) string {
	return fmt.Sprintf("`%s`.`%s`", bq.config.Project, bq.NamespaceName(namespace)) + "." + bq.tableHelper.quotedTableName(tableName)
}

func tableNameFunc(identifier string, alphanumeric bool) (adapted string, needQuote bool) {
	return identifier, !alphanumeric ||
		!utils.IsLowerAlphanumeric(identifier) ||
		!utils.IsLowerLetterOrUnderscore(int32(identifier[0]))
}

func columnNameFunc(identifier string, alphanumeric bool) (adapted string, needQuote bool) {
	cleanIdentifier := identifier
	if !alphanumeric {
		cleanIdentifier = bigqueryColumnUnsupportedCharacters.ReplaceAllString(strings.ReplaceAll(identifier, " ", "_"), "")
		if cleanIdentifier == "" || utils.IsSameSymbol(cleanIdentifier, '_') {
			return fmt.Sprintf("column_%x", utils.HashString(identifier)), false
		}
	}
	if utils.IsNumber(int32(cleanIdentifier[0])) {
		cleanIdentifier = "_" + cleanIdentifier
	}

	lc := strings.ToLower(cleanIdentifier)
	if bigqueryReservedWordsSet.Contains(lc) {
		return cleanIdentifier, true
	}
	for _, reserved := range bigqueryReservedPrefixes {
		if strings.HasPrefix(lc, reserved) {
			return utils.ShortenString("_"+cleanIdentifier, 300), false
		}
	}
	return utils.ShortenString(cleanIdentifier, 300), false
}

func (bq *BigQuery) TableName(identifier string) string {
	return bq.tableHelper.TableName(identifier)
}

func (bq *BigQuery) ColumnName(identifier string) string {
	return bq.tableHelper.ColumnName(identifier)
}

func (bq *BigQuery) quotedColumnName(identifier string) string {
	return bq.tableHelper.quotedColumnName(identifier)
}

func (bq *BigQuery) GetSQLType(dataType types2.DataType) (string, bool) {
	v, ok := bigqueryTypeMapping[dataType]
	return v, ok
}

func (bq *BigQuery) GetDataType(sqlType string) (types2.DataType, bool) {
	v, ok := bigqueryReverseTypeMapping[sqlType]
	return v, ok
}

func (bq *BigQuery) GetAvroType(sqlType string) (any, bool) {
	v, ok := bigqueryAvroTypes[strings.ToUpper(sqlType)]
	return v, ok
}

func (bq *BigQuery) GetAvroSchema(table *Table) *types2.AvroSchema {
	schema := types2.AvroSchema{
		Type: "record",
		Name: "jitsu",
	}
	fields := make([]types2.AvroType, 0, table.ColumnsCount())
	dataTypes := make(map[string]types2.DataType, table.ColumnsCount())
	for el := table.Columns.Front(); el != nil; el = el.Next() {
		name := el.Key
		col := el.Value
		dataTypes[name] = col.DataType
		if col.Override && col.Type != "" {
			avroType, ok := bq.GetAvroType(col.Type)
			if !ok {
				avroType = []any{"null", map[string]string{"type": "string", "sqlType": col.Type}}
			}
			fields = append(fields, types2.AvroType{Name: name, Type: avroType, Default: nil})
		} else {
			fields = append(fields, types2.AvroType{Name: name, Type: col.DataType.AvroType(), Default: nil})
		}
	}
	schema.DataTypes = dataTypes
	schema.Fields = fields
	return &schema
}

func (bq *BigQuery) TableHelper() *TableHelper {
	return &bq.tableHelper
}

func (bq *BigQuery) DefaultNamespace() string {
	return bq.config.Dataset
}

func (bq *BigQuery) TmpNamespace(namespace string) string {
	return namespace
}

func (bq *BigQuery) TmpTableUsePK() bool {
	return true
}

func (bq *BigQuery) NamespaceName(namespace string) string {
	return bq.tableHelper.TableName(utils.DefaultString(namespace, bq.config.Dataset))
}

func (bq *BigQuery) DoLocalDeduplication() bool {
	return true
}

type JobRunner interface {
	Run(ctx context.Context) (*bigquery.Job, error)
}

func (bq *BigQuery) RunJob(ctx context.Context, runner JobRunner, jobDescription string) (job *bigquery.Job, state bulker.WarehouseState, err error) {
	defer func() {
		bq.logQuery(jobDescription, runner, err)
	}()
	startTime := time.Now()
	state = bulker.WarehouseState{}
	var status *bigquery.JobStatus
	var jobID string
	job, err = runner.Run(ctx)
	if err == nil {
		jobID = " Job ID: " + job.ID()
		status, err = job.Wait(ctx)
		if err == nil {
			err = status.Err()
		}
	}
	bytesProcessed := ""
	state.TimeProcessedMs = time.Since(startTime).Milliseconds()
	if status != nil && status.Statistics != nil {
		state.BytesProcessed = int(status.Statistics.TotalBytesProcessed)
		state.EstimatedCost = float64(status.Statistics.TotalBytesProcessed) * 6.25 / 1_000_000_000_000
		bytesProcessed = fmt.Sprintf(" Bytes processed: %d", status.Statistics.TotalBytesProcessed)
	}
	if err != nil {
		if status != nil && len(status.Errors) > 0 {
			builder := strings.Builder{}
			for _, statusError := range status.Errors {
				builder.WriteString(fmt.Sprintf("%s\n", statusError.Error()))
			}
			err = errors.New(builder.String())
		}
		return job, state, fmt.Errorf("Failed to %s.%s Completed with error: %v%s", jobDescription, jobID, err, bytesProcessed)
	} else {
		bq.Debugf("Successfully %s.%s%s in %.2f s.", jobDescription, jobID, bytesProcessed, time.Since(startTime).Seconds())
		return job, state, nil
	}
}
