package adapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/errorj"
	"math"
	"net/http"
	"strings"

	"cloud.google.com/go/bigquery"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/typing"
	"google.golang.org/api/googleapi"
)

const (
	deleteBigQueryTemplate   = "DELETE FROM `%s.%s.%s` WHERE %s"
	truncateBigQueryTemplate = "TRUNCATE TABLE `%s.%s.%s`"

	rowsLimitPerInsertOperation = 500
)

var (
	//SchemaToBigQueryString is mapping between JSON types and BigQuery types
	SchemaToBigQueryString = map[typing.DataType]string{
		typing.STRING:    string(bigquery.StringFieldType),
		typing.INT64:     string(bigquery.IntegerFieldType),
		typing.FLOAT64:   string(bigquery.FloatFieldType),
		typing.TIMESTAMP: string(bigquery.TimestampFieldType),
		typing.BOOL:      string(bigquery.BooleanFieldType),
		typing.UNKNOWN:   string(bigquery.StringFieldType),
	}
)

//BigQuery adapter for creating,patching (schema or table), inserting and copying data from gcs to BigQuery
type BigQuery struct {
	ctx         context.Context
	client      *bigquery.Client
	config      *GoogleConfig
	queryLogger *logging.QueryLogger
	sqlTypes    typing.SQLTypes
}

//NewBigQuery return configured BigQuery adapter instance
func NewBigQuery(ctx context.Context, config *GoogleConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*BigQuery, error) {

	var client *bigquery.Client
	var err error
	if config.credentials == nil {
		client, err = bigquery.NewClient(ctx, config.Project)
	} else {
		client, err = bigquery.NewClient(ctx, config.Project, config.credentials)
	}

	if err != nil {
		return nil, fmt.Errorf("Error creating BigQuery client: %v", err)
	}

	return &BigQuery{ctx: ctx, client: client, config: config, queryLogger: queryLogger, sqlTypes: reformatMappings(sqlTypes, SchemaToBigQueryString)}, nil
}

//Copy transfers data from google cloud storage file to google BigQuery table as one batch
func (bq *BigQuery) Copy(fileKey, tableName string) error {
	table := bq.client.Dataset(bq.config.Dataset).Table(tableName)

	gcsRef := bigquery.NewGCSReference(fmt.Sprintf("gs://%s/%s", bq.config.Bucket, fileKey))
	gcsRef.SourceFormat = bigquery.JSON
	loader := table.LoaderFrom(gcsRef)
	loader.CreateDisposition = bigquery.CreateNever

	job, err := loader.Run(bq.ctx)
	if err != nil {
		return errorj.CopyError.Wrap(err, "failed to run BQ loader").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}
	jobStatus, err := job.Wait(bq.ctx)
	if err != nil {
		return errorj.CopyError.Wrap(err, "failed to wait BQ job").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	if jobStatus.Err() != nil {
		return errorj.CopyError.Wrap(jobStatus.Err(), "failed due to BQ job status").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	return nil
}

func (bq *BigQuery) Test() error {
	_, err := bq.client.Query("SELECT 1;").Read(context.Background())
	return err
}

//Insert inserts data with InsertContext as a single object or a batch into BigQuery
func (bq *BigQuery) Insert(insertContext *InsertContext) error {
	if insertContext.eventContext != nil {
		return bq.insertSingle(insertContext.eventContext)
	} else {
		return bq.insertBatch(insertContext.table, insertContext.objects)
	}

}

//GetTableSchema return google BigQuery table (name,columns) representation wrapped in Table struct
func (bq *BigQuery) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Schema: bq.config.Dataset, Name: tableName, Columns: Columns{}}

	bqTable := bq.client.Dataset(bq.config.Dataset).Table(tableName)

	meta, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		if isNotFoundErr(err) {
			return table, nil
		}

		return nil, errorj.GetTableError.Wrap(err, "failed to get table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	for _, field := range meta.Schema {
		table.Columns[field.Name] = typing.SQLColumn{Type: string(field.Type)}
	}

	return table, nil
}

//CreateTable creates google BigQuery table from Table
func (bq *BigQuery) CreateTable(table *Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(table.Name)

	_, err := bqTable.Metadata(bq.ctx)
	if err == nil {
		logging.Info("BigQuery table", table.Name, "already exists")
		return nil
	}

	if !isNotFoundErr(err) {
		return errorj.GetTableError.Wrap(err, "failed to get table metadata").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   table.Name,
			})
	}

	bqSchema := bigquery.Schema{}
	for _, columnName := range table.SortedColumnNames() {
		column := table.Columns[columnName]
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.DDLType()))
		sqlType, ok := bq.sqlTypes[columnName]
		if ok {
			bigQueryType = bigquery.FieldType(strings.ToUpper(sqlType.DDLType()))
		}
		bqSchema = append(bqSchema, &bigquery.FieldSchema{Name: columnName, Type: bigQueryType})
	}
	bq.logQuery("Creating table for schema: ", bqSchema, true)
	if err := bqTable.Create(bq.ctx, &bigquery.TableMetadata{Name: table.Name, Schema: bqSchema}); err != nil {
		return errorj.GetTableError.Wrap(err, "failed to create table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset:   bq.config.Dataset,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     table.Name,
				Statement: fmt.Sprintf("%v", bqSchema),
			})
	}

	return nil
}

//CreateDataset creates google BigQuery Dataset if doesn't exist
func (bq *BigQuery) CreateDataset(dataset string) error {
	bqDataset := bq.client.Dataset(dataset)
	if _, err := bqDataset.Metadata(bq.ctx); err != nil {
		if isNotFoundErr(err) {
			datasetMetadata := &bigquery.DatasetMetadata{Name: dataset}
			bq.logQuery("Creating dataset: ", datasetMetadata, true)
			if err := bqDataset.Create(bq.ctx, datasetMetadata); err != nil {
				return errorj.CreateSchemaError.Wrap(err, "failed to create dataset").
					WithProperty(errorj.DBInfo, &ErrorPayload{
						Dataset: dataset,
					})
			}
		} else {
			return errorj.CreateSchemaError.Wrap(err, "failed to get dataset metadata").
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Dataset: dataset,
				})
		}
	}

	return nil
}

//PatchTableSchema adds Table columns to google BigQuery table
func (bq *BigQuery) PatchTableSchema(patchSchema *Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(patchSchema.Name)
	metadata, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		return errorj.PatchTableError.Wrap(err, "failed to get table metadata").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   patchSchema.Name,
			})
	}

	for _, columnName := range patchSchema.SortedColumnNames() {
		column := patchSchema.Columns[columnName]
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.DDLType()))
		sqlType, ok := bq.sqlTypes[columnName]
		if ok {
			bigQueryType = bigquery.FieldType(strings.ToUpper(sqlType.DDLType()))
		}
		metadata.Schema = append(metadata.Schema, &bigquery.FieldSchema{Name: columnName, Type: bigQueryType})
	}
	updateReq := bigquery.TableMetadataToUpdate{Schema: metadata.Schema}
	bq.logQuery("Patch update request: ", updateReq, true)
	if _, err := bqTable.Update(bq.ctx, updateReq, metadata.ETag); err != nil {
		return errorj.PatchTableError.Wrap(err, "failed to patch table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset:   bq.config.Dataset,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     patchSchema.Name,
				Statement: fmt.Sprintf("%v", updateReq),
			})
	}

	return nil
}

// DeleteWithConditions tries to remove rows with specific conditions.
// Note that rows that were written to a table recently by using streaming
// (the tabledata.insertall method or the Storage Write API)
// cannot be modified with UPDATE, DELETE, or MERGE statements.
// Recent writes are typically those that occur within the last 30 minutes.
// https://cloud.google.com/bigquery/docs/reference/standard-sql/data-manipulation-language#limitations
func (bq *BigQuery) DeleteWithConditions(tableName string, deleteConditions *DeleteConditions) error {
	deleteCondition := bq.toDeleteQuery(deleteConditions)
	query := fmt.Sprintf(deleteBigQueryTemplate, bq.config.Project, bq.config.Dataset, tableName, deleteCondition)
	bq.queryLogger.LogQuery(query)
	if _, err := bq.client.Query(query).Read(bq.ctx); err != nil {
		return errorj.DeleteFromTableError.Wrap(err, "failed to delete data").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset:   bq.config.Dataset,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     tableName,
				Statement: query,
			})
	}

	return nil
}

//insertBatch streams data into BQ using stream API
func (bq *BigQuery) insertSingle(eventContext *EventContext) error {
	inserter := bq.client.Dataset(bq.config.Dataset).Table(eventContext.Table.Name).Inserter()
	bq.logQuery(fmt.Sprintf("Inserting values to table %s: ", eventContext.Table.Name), eventContext.ProcessedEvent, false)

	if err := bq.insertItems(inserter, []*BQItem{{values: eventContext.ProcessedEvent}}); err != nil {
		return errorj.ExecuteInsertError.Wrap(err, "failed to execute single insert").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset:   bq.config.Dataset,
				Bucket:    bq.config.Bucket,
				Project:   bq.config.Project,
				Table:     eventContext.Table.Name,
				Statement: fmt.Sprintf("%v", eventContext.ProcessedEvent),
			})
	}

	return nil
}

//insertBatch streams data into BQ using stream API
//1 insert = max 500 rows
func (bq *BigQuery) insertBatch(table *Table, objects []map[string]interface{}) error {
	inserter := bq.client.Dataset(bq.config.Dataset).Table(table.Name).Inserter()
	bq.logQuery(fmt.Sprintf("Inserting [%d] values to table %s using BigQuery Streaming API with chunks [%d]: ", len(objects), table.Name, rowsLimitPerInsertOperation), objects, false)

	items := make([]*BQItem, 0, rowsLimitPerInsertOperation)
	operation := 0
	operations := int(math.Max(1, float64(len(objects))/float64(rowsLimitPerInsertOperation)))
	for _, object := range objects {
		if len(items) > rowsLimitPerInsertOperation {
			operation++
			if err := bq.insertItems(inserter, items); err != nil {
				return errorj.DeleteFromTableError.Wrap(err, "failed to execute middle insert %d of %d in batch", operation, operations).
					WithProperty(errorj.DBInfo, &ErrorPayload{
						Dataset: bq.config.Dataset,
						Bucket:  bq.config.Bucket,
						Project: bq.config.Project,
						Table:   table.Name,
					})
			}

			items = make([]*BQItem, 0, rowsLimitPerInsertOperation)
		}

		items = append(items, &BQItem{values: object})
	}

	if len(items) > 0 {
		operation++
		if err := bq.insertItems(inserter, items); err != nil {
			return errorj.DeleteFromTableError.Wrap(err, "failed to execute last insert %d of %d in batch", operation, operations).
				WithProperty(errorj.DBInfo, &ErrorPayload{
					Dataset: bq.config.Dataset,
					Bucket:  bq.config.Bucket,
					Project: bq.config.Project,
					Table:   table.Name,
				})
		}
	}

	return nil
}

//DropTable drops table from BigQuery
func (bq *BigQuery) DropTable(table *Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(table.Name)

	if err := bqTable.Delete(bq.ctx); err != nil {
		return errorj.DropError.Wrap(err, "failed to drop table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   table.Name,
			})
	}

	return nil
}

//Truncate deletes all records in tableName table
func (bq *BigQuery) Truncate(tableName string) error {
	query := fmt.Sprintf(truncateBigQueryTemplate, bq.config.Project, bq.config.Dataset, tableName)
	bq.queryLogger.LogQuery(query)
	if _, err := bq.client.Query(query).Read(bq.ctx); err != nil {
		return errorj.TruncateError.Wrap(err, "failed to truncate table").
			WithProperty(errorj.DBInfo, &ErrorPayload{
				Dataset: bq.config.Dataset,
				Bucket:  bq.config.Bucket,
				Project: bq.config.Project,
				Table:   tableName,
			})
	}

	return nil
}

func (bq *BigQuery) insertItems(inserter *bigquery.Inserter, items []*BQItem) error {
	if err := inserter.Put(bq.ctx, items); err != nil {
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

func (bq *BigQuery) toDeleteQuery(conditions *DeleteConditions) string {
	var queryConditions []string

	for _, condition := range conditions.Conditions {
		conditionString := fmt.Sprintf("%v %v %q", condition.Field, condition.Clause, condition.Value)
		queryConditions = append(queryConditions, conditionString)
	}

	return strings.Join(queryConditions, conditions.JoinCondition)
}

func (bq *BigQuery) logQuery(messageTemplate string, entity interface{}, ddl bool) {
	entityJSON, err := json.Marshal(entity)
	if err != nil {
		logging.Warnf("Failed to serialize entity for logging: %s", fmt.Sprint(entity))
	} else {
		if ddl {
			bq.queryLogger.LogDDL(messageTemplate + string(entityJSON))
		} else {
			bq.queryLogger.LogQuery(messageTemplate + string(entityJSON))
		}
	}
}

func (bq *BigQuery) Close() error {
	return bq.client.Close()
}

//Return true if google err is 404
func isNotFoundErr(err error) bool {
	e, ok := err.(*googleapi.Error)
	return ok && e.Code == http.StatusNotFound
}

//BQItem struct for streaming inserts to BigQuery
type BQItem struct {
	values map[string]interface{}
}

func (bqi *BQItem) Save() (row map[string]bigquery.Value, insertID string, err error) {
	row = map[string]bigquery.Value{}

	for k, v := range bqi.values {
		row[k] = v
	}

	return
}

func (bq *BigQuery) Update(table *Table, object map[string]interface{}, whereKey string, whereValue interface{}) error {
	return errors.New("BigQuery doesn't support updates")
}
