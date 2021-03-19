package adapters

import (
	"cloud.google.com/go/bigquery"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/server/logging"
	"github.com/jitsucom/eventnative/server/typing"
	"google.golang.org/api/googleapi"
	"net/http"
	"strings"
)

var (
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
	ctx              context.Context
	client           *bigquery.Client
	config           *GoogleConfig
	queryLogger      *logging.QueryLogger
	mappingTypeCasts map[string]string
}

//NewBigQuery return configured BigQuery adapter instance
func NewBigQuery(ctx context.Context, config *GoogleConfig, queryLogger *logging.QueryLogger, mappingTypeCasts map[string]string) (*BigQuery, error) {
	client, err := bigquery.NewClient(ctx, config.Project, config.credentials)
	if err != nil {
		return nil, fmt.Errorf("Error creating BigQuery client: %v", err)
	}

	return &BigQuery{ctx: ctx, client: client, config: config, queryLogger: queryLogger, mappingTypeCasts: reformatMappings(mappingTypeCasts, SchemaToBigQueryString)}, nil
}

//Transfer data from google cloud storage file to google BigQuery table as one batch
func (bq *BigQuery) Copy(fileKey, tableName string) error {
	table := bq.client.Dataset(bq.config.Dataset).Table(tableName)

	gcsRef := bigquery.NewGCSReference(fmt.Sprintf("gs://%s/%s", bq.config.Bucket, fileKey))
	gcsRef.SourceFormat = bigquery.JSON
	loader := table.LoaderFrom(gcsRef)
	loader.CreateDisposition = bigquery.CreateNever

	job, err := loader.Run(bq.ctx)
	if err != nil {
		return fmt.Errorf("Error running loading from google cloud storage to BigQuery table %s: %v", tableName, err)
	}
	jobStatus, err := job.Wait(bq.ctx)
	if err != nil {
		return fmt.Errorf("Error waiting loading job from google cloud storage to BigQuery table %s: %v", tableName, err)
	}

	if jobStatus.Err() != nil {
		return fmt.Errorf("Error loading from google cloud storage to BigQuery table %s: %v", tableName, err)
	}

	return nil
}

func (bq *BigQuery) Test() error {
	_, err := bq.client.Query("SELECT 1;").Read(context.Background())
	return err
}

//Insert provided object in BigQuery in stream mode
func (bq *BigQuery) Insert(schema *Table, valuesMap map[string]interface{}) error {
	inserter := bq.client.Dataset(bq.config.Dataset).Table(schema.Name).Inserter()
	bq.logQuery(fmt.Sprintf("Inserting values to table %s: ", schema.Name), valuesMap, false)
	return inserter.Put(bq.ctx, BQItem{values: valuesMap})
}

//GetTableSchema return google BigQuery table (name,columns) representation wrapped in Table struct
func (bq *BigQuery) GetTableSchema(tableName string) (*Table, error) {
	table := &Table{Name: tableName, Columns: Columns{}}

	bqTable := bq.client.Dataset(bq.config.Dataset).Table(tableName)

	meta, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		if isNotFoundErr(err) {
			return table, nil
		}

		return nil, fmt.Errorf("Error querying BigQuery table [%s] metadata: %v", tableName, err)
	}

	for _, field := range meta.Schema {
		table.Columns[field.Name] = Column{SqlType: string(field.Type)}
	}

	return table, nil
}

//Create google BigQuery table from Table
func (bq *BigQuery) CreateTable(table *Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(table.Name)

	_, err := bqTable.Metadata(bq.ctx)
	if err == nil {
		logging.Info("BigQuery table", table.Name, "already exists")
		return nil
	}

	if !isNotFoundErr(err) {
		return fmt.Errorf("Error getting new table %s metadata: %v", table.Name, err)
	}

	bqSchema := bigquery.Schema{}
	for columnName, column := range table.Columns {
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.SqlType))
		castedType, ok := bq.mappingTypeCasts[columnName]
		if ok {
			bigQueryType = bigquery.FieldType(strings.ToUpper(castedType))
		}
		bqSchema = append(bqSchema, &bigquery.FieldSchema{Name: columnName, Type: bigQueryType})
	}
	bq.logQuery("Creating table for schema: ", bqSchema, true)
	if err := bqTable.Create(bq.ctx, &bigquery.TableMetadata{Name: table.Name, Schema: bqSchema}); err != nil {
		return fmt.Errorf("Error creating [%s] BigQuery table %v", table.Name, err)
	}

	return nil
}

//Create google BigQuery Dataset if doesn't exist
func (bq *BigQuery) CreateDataset(dataset string) error {
	bqDataset := bq.client.Dataset(dataset)
	if _, err := bqDataset.Metadata(bq.ctx); err != nil {
		if isNotFoundErr(err) {
			datasetMetadata := &bigquery.DatasetMetadata{Name: dataset}
			bq.logQuery("Creating dataset: ", datasetMetadata, true)
			if err := bqDataset.Create(bq.ctx, datasetMetadata); err != nil {
				return fmt.Errorf("Error creating dataset %s in BigQuery: %v", dataset, err)
			}
		} else {
			return fmt.Errorf("Error getting dataset %s in BigQuery: %v", dataset, err)
		}
	}

	return nil
}

//Add Table columns to google BigQuery table
func (bq *BigQuery) PatchTableSchema(patchSchema *Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(patchSchema.Name)
	metadata, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		return fmt.Errorf("Error getting table %s metadata: %v", patchSchema.Name, err)
	}

	for columnName, column := range patchSchema.Columns {
		bigQueryType := bigquery.FieldType(strings.ToUpper(column.SqlType))
		castedType, ok := bq.mappingTypeCasts[columnName]
		if ok {
			bigQueryType = bigquery.FieldType(strings.ToUpper(castedType))
		}
		metadata.Schema = append(metadata.Schema, &bigquery.FieldSchema{Name: columnName, Type: bigQueryType})
	}
	updateReq := bigquery.TableMetadataToUpdate{Schema: metadata.Schema}
	bq.logQuery("Patch update request: ", updateReq, true)
	if _, err := bqTable.Update(bq.ctx, updateReq, metadata.ETag); err != nil {
		var columns []string
		for _, column := range metadata.Schema {
			columns = append(columns, fmt.Sprintf("%s - %s", column.Name, column.Type))
		}
		return fmt.Errorf("Error patching %s BigQuery table with %s schema: %v", patchSchema.Name, strings.Join(columns, ","), err)
	}

	return nil
}

func (bq *BigQuery) logQuery(messageTemplate string, entity interface{}, ddl bool) {
	entityJson, err := json.Marshal(entity)
	if err != nil {
		logging.Warnf("Failed to serialize entity for logging: %s", fmt.Sprint(entity))
	} else {
		if ddl {
			bq.queryLogger.LogDDL(messageTemplate + string(entityJson))
		} else {
			bq.queryLogger.LogQuery(messageTemplate + string(entityJson))
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

func (bqi BQItem) Save() (row map[string]bigquery.Value, insertID string, err error) {
	row = map[string]bigquery.Value{}

	for k, v := range bqi.values {
		row[k] = v
	}

	return
}
