package adapters

import (
	"cloud.google.com/go/bigquery"
	"context"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	"google.golang.org/api/googleapi"
	"net/http"
	"strings"
)

var (
	SchemaToBigQuery = map[typing.DataType]bigquery.FieldType{
		typing.STRING:    bigquery.StringFieldType,
		typing.INT64:     bigquery.IntegerFieldType,
		typing.FLOAT64:   bigquery.FloatFieldType,
		typing.TIMESTAMP: bigquery.TimestampFieldType,
	}

	BigQueryToSchema = map[bigquery.FieldType]typing.DataType{
		bigquery.StringFieldType:    typing.STRING,
		bigquery.IntegerFieldType:   typing.INT64,
		bigquery.FloatFieldType:     typing.FLOAT64,
		bigquery.TimestampFieldType: typing.TIMESTAMP,
	}
)

type BigQuery struct {
	ctx           context.Context
	client        *bigquery.Client
	config        *GoogleConfig
	queryLogger   *logging.QueryLogger
	destinationId string
}

func NewBigQuery(ctx context.Context, config *GoogleConfig, queryLogger *logging.QueryLogger, destinationId string) (*BigQuery, error) {
	if destinationId == "" {
		return nil, fmt.Errorf("destinationId must be not empty")
	}
	if queryLogger == nil {
		queryLogger = &logging.QueryLogger{}
	}
	client, err := bigquery.NewClient(ctx, config.Project, config.credentials)
	if err != nil {
		return nil, fmt.Errorf("Error creating BigQuery client: %v", err)
	}

	return &BigQuery{ctx: ctx, client: client, config: config, queryLogger: queryLogger, destinationId: destinationId}, nil
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
func (bq *BigQuery) Insert(schema *schema.Table, valuesMap map[string]interface{}) error {
	inserter := bq.client.Dataset(bq.config.Dataset).Table(schema.Name).Inserter()

	return inserter.Put(bq.ctx, BQItem{values: valuesMap})
}

//Return google BigQuery table representation(name, columns with types) as schema.Table
func (bq *BigQuery) GetTableSchema(tableName string) (*schema.Table, error) {
	table := &schema.Table{Name: tableName, Columns: schema.Columns{}}

	bqTable := bq.client.Dataset(bq.config.Dataset).Table(tableName)

	meta, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		if isNotFoundErr(err) {
			return table, nil
		}

		return nil, fmt.Errorf("Error querying BigQuery table [%s] metadata: %v", tableName, err)
	}

	for _, field := range meta.Schema {
		mappedType, ok := BigQueryToSchema[field.Type]
		if !ok {
			logging.Error("Unknown BigQuery column type:", field.Type)
			mappedType = typing.STRING
		}
		table.Columns[field.Name] = schema.NewColumn(mappedType)
	}

	return table, nil
}

//Create google BigQuery table from schema.Table
func (bq *BigQuery) CreateTable(tableSchema *schema.Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(tableSchema.Name)

	_, err := bqTable.Metadata(bq.ctx)
	if err == nil {
		logging.Info("BigQuery table", tableSchema.Name, "already exists")
		return nil
	}

	if !isNotFoundErr(err) {
		return fmt.Errorf("Error getting new table %s metadata: %v", tableSchema.Name, err)
	}

	bqSchema := bigquery.Schema{}
	for columnName, column := range tableSchema.Columns {
		mappedType, ok := SchemaToBigQuery[column.GetType()]
		if !ok {
			logging.Error("Unknown BigQuery schema type:", column.GetType())
			mappedType = SchemaToBigQuery[typing.STRING]
		}
		bqSchema = append(bqSchema, &bigquery.FieldSchema{Name: columnName, Type: mappedType})
	}

	if err := bqTable.Create(bq.ctx, &bigquery.TableMetadata{Name: tableSchema.Name, Schema: bqSchema}); err != nil {
		return fmt.Errorf("Error creating [%s] BigQuery table %v", tableSchema.Name, err)
	}

	return nil
}

//Create google BigQuery Dataset if doesn't exist
func (bq *BigQuery) CreateDataset(dataset string) error {
	bqDataset := bq.client.Dataset(dataset)
	if _, err := bqDataset.Metadata(bq.ctx); err != nil {
		if isNotFoundErr(err) {
			if err := bqDataset.Create(bq.ctx, &bigquery.DatasetMetadata{Name: dataset}); err != nil {
				return fmt.Errorf("Error creating dataset %s in BigQuery: %v", dataset, err)
			}
		} else {
			return fmt.Errorf("Error getting dataset %s in BigQuery: %v", dataset, err)
		}
	}

	return nil
}

//Add schema.Table columns to google BigQuery table
func (bq *BigQuery) PatchTableSchema(patchSchema *schema.Table) error {
	bqTable := bq.client.Dataset(bq.config.Dataset).Table(patchSchema.Name)
	metadata, err := bqTable.Metadata(bq.ctx)
	if err != nil {
		return fmt.Errorf("Error getting table %s metadata: %v", patchSchema.Name, err)
	}

	for columnName, column := range patchSchema.Columns {
		mappedColumnType, ok := SchemaToBigQuery[column.GetType()]
		if !ok {
			logging.Error("Unknown BigQuery schema type:", column.GetType().String())
			mappedColumnType = SchemaToBigQuery[typing.STRING]
		}
		metadata.Schema = append(metadata.Schema, &bigquery.FieldSchema{Name: columnName, Type: mappedColumnType})
	}

	updateReq := bigquery.TableMetadataToUpdate{Schema: metadata.Schema}
	if _, err := bqTable.Update(bq.ctx, updateReq, metadata.ETag); err != nil {
		var columns []string
		for _, column := range metadata.Schema {
			columns = append(columns, fmt.Sprintf("%s - %s", column.Name, column.Type))
		}
		return fmt.Errorf("Error patching %s BigQuery table with %s schema: %v", patchSchema.Name, strings.Join(columns, ","), err)
	}

	return nil
}

func (bq *BigQuery) UpdatePrimaryKey(patchTableSchema *schema.Table, patchConstraint *schema.PKFieldsPatch) error {
	logging.Warn("Constraints update is not supported for BigQuery yet")
	return nil
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
