package storages

import (
	"context"
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/schema"
	"log"
	"strings"
	"time"
)

const tableFileKeyDelimiter = "-table-"

//Store files to aws RedShift via aws s3 in batch mode (1 file = 1 transaction)
//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to recreate this structure
//for keeping actual db tables schema state
type AwsRedshift struct {
	name            string
	sourceDir       string
	s3Adapter       *adapters.S3
	redshiftAdapter *adapters.AwsRedshift
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	breakOnError    bool
}

func NewAwsRedshift(ctx context.Context, name, sourceDir string, s3Config *adapters.S3Config, redshiftConfig *adapters.DataSourceConfig,
	processor *schema.Processor, breakOnError bool) (*AwsRedshift, error) {
	s3Adapter, err := adapters.NewS3(s3Config)
	if err != nil {
		return nil, err
	}

	redshiftAdapter, err := adapters.NewAwsRedshift(ctx, redshiftConfig, s3Config)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = redshiftAdapter.CreateDbSchema(redshiftConfig.Schema)
	if err != nil {
		return nil, err
	}

	ar := &AwsRedshift{
		name:            name,
		sourceDir:       sourceDir,
		s3Adapter:       s3Adapter,
		redshiftAdapter: redshiftAdapter,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		breakOnError:    breakOnError,
	}

	fr := &(FileReader{dir: sourceDir, storage: ar})
	fr.start()
	ar.start()

	return ar, nil
}

//Periodically (every 30 seconds):
//1. get all files from aws s3
//2. load them to aws Redshift via Copy request
//3. delete file from aws s3
func (ar *AwsRedshift) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := ar.s3Adapter.ListBucket(appconfig.Instance.ServerName)
			if err != nil {
				log.Println("Error reading files from s3", err)
				continue
			}

			if len(filesKeys) == 0 {
				continue
			}

			for _, fileKey := range filesKeys {
				names := strings.Split(fileKey, tableFileKeyDelimiter)
				if len(names) != 2 {
					log.Printf("S3 file [%s] has wrong format! Right format: $filename%s$tablename. This file will be skipped.", fileKey, tableFileKeyDelimiter)
					continue
				}
				wrappedTx, err := ar.redshiftAdapter.OpenTx()
				if err != nil {
					log.Println("Error creating redshift transaction", err)
					continue
				}

				if err := ar.redshiftAdapter.Copy(wrappedTx, fileKey, names[1]); err != nil {
					log.Printf("Error copying file [%s] from s3 to redshift: %v", fileKey, err)
					wrappedTx.Rollback()
					continue
				}

				wrappedTx.Commit()
				//TODO may be we need to have a journal for collecting already processed files names
				// if ar.s3Adapter.DeleteObject fails => it will be processed next time => duplicate data
				if err := ar.s3Adapter.DeleteObject(fileKey); err != nil {
					log.Println("System error: file", fileKey, "wasn't deleted from s3 and will be inserted in db again", err)
					continue
				}

			}
		}
	}()
}

//Store file from byte payload to s3 with processing
func (ar *AwsRedshift) Store(fileName string, payload []byte) error {
	flatData, err := ar.schemaProcessor.ProcessFilePayloadIntoBytes(fileName, payload, ar.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbTableSchema, ok := ar.tables[fdata.DataSchema.Name]
		if !ok {
			//Get or Create Table
			dbTableSchema, err = ar.redshiftAdapter.GetTableSchema(fdata.DataSchema.Name)
			if err != nil {
				return fmt.Errorf("Error getting table %s schema from redshift: %v", fdata.DataSchema.Name, err)
			}
			if !dbTableSchema.Exists() {
				if err := ar.redshiftAdapter.CreateTable(fdata.DataSchema); err != nil {
					return fmt.Errorf("Error creating table %s in redshift: %v", fdata.DataSchema.Name, err)
				}
				dbTableSchema = fdata.DataSchema
			}
			//Save
			ar.tables[dbTableSchema.Name] = dbTableSchema
		}

		schemaDiff := dbTableSchema.Diff(fdata.DataSchema)
		//Patch
		if schemaDiff.Exists() {
			if err := ar.redshiftAdapter.PatchTableSchema(schemaDiff); err != nil {
				return fmt.Errorf("Error patching table schema %s in redshift: %v", schemaDiff.Name, err)
			}
			//Save
			for k, v := range schemaDiff.Columns {
				dbTableSchema.Columns[k] = v
			}
		}
	}
	//TODO put them all in one folder and if all ok => move them all to next working folder
	for _, fdata := range flatData {
		err := ar.s3Adapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.Payload.Bytes())
		if err != nil {
			return err
		}
	}

	return nil
}

func (ar *AwsRedshift) Name() string {
	return ar.name
}

func (ar *AwsRedshift) Type() string {
	return "Redshift"
}

func (ar *AwsRedshift) SourceDir() string {
	return ar.sourceDir
}

func (ar *AwsRedshift) Close() error {
	if err := ar.redshiftAdapter.Close(); err != nil {
		return fmt.Errorf("Error closing redshift datasource: %v", err)
	}

	return nil
}
