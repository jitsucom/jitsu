package sql

import (
	"context"
	"errors"
	"fmt"
	"regexp"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	types2 "github.com/jitsucom/bulker/bulkerlib/types"
)

const ContextTransactionKey = "transaction"

var notExistRegexp = regexp.MustCompile(`(?i)(not|doesn't)\sexist`)

var ErrTableNotExist = errors.New("table doesn't exist")

// TODO Use prepared statements?
// TODO: Avoid SQL injection - use own method instead of printf

// SQLAdapter is a manager for DWH tables
type SQLAdapter interface {
	Type() string

	//GetSQLType return mapping from generic bulker type to SQL type specific for this database
	GetSQLType(dataType types2.DataType) (string, bool)
	GetDataType(sqlType string) (types2.DataType, bool)
	GetAvroType(sqlType string) (any, bool)
	GetAvroSchema(table *Table) *types2.AvroSchema
	GetBatchFileFormat() types2.FileFormat
	GetBatchFileCompression() types2.FileCompression
	StringifyObjects() bool
	OpenTx(ctx context.Context) (*TxSQLAdapter, error)
	Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error
	Ping(ctx context.Context) error
	// InitDatabase setups required db objects like 'schema' or 'dataset' if they don't exist
	InitDatabase(ctx context.Context) error
	TableHelper() *TableHelper
	GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error)
	CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error)
	CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (state bulker.WarehouseState, err error)
	LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (state bulker.WarehouseState, err error)
	PatchTableSchema(ctx context.Context, patchTable *Table) (*Table, error)
	TruncateTable(ctx context.Context, namespace string, tableName string) error
	//(ctx context.Context, tableName string, object types.Object, whenConditions *WhenConditions) error
	Delete(ctx context.Context, namespace string, tableName string, deleteConditions *WhenConditions) error
	DropTable(ctx context.Context, namespace string, tableName string, ifExists bool) error
	Drop(ctx context.Context, table *Table, ifExists bool) error

	ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) error

	Select(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error)
	Count(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions) (int, error)

	// ColumnName adapts column name to sql identifier rules of database
	ColumnName(rawColumn string) string
	// TableName adapts table name to sql identifier rules of database
	TableName(rawTableName string) string
	NamespaceName(namespace string) string
	DefaultNamespace() string
	// TmpNamespace returns namespace used by temporary tables, e.g. for warehouses where temporary tables
	// must not be specified with schema or db prefix NoNamespaceValue constant must be used
	TmpNamespace(targetNamespace string) string
	// TmpTableUsePK Create temporary tables with primary key.
	// May be useful for Merge performance in some warehouses
	TmpTableUsePK() bool
	DoLocalDeduplication() bool
}

type LoadSourceType string

const (
	LocalFile        LoadSourceType = "local_file"
	GoogleCloudStore LoadSourceType = "google_cloud_store"
	AmazonS3         LoadSourceType = "amazon_s3"
)

type LoadSource struct {
	Type     LoadSourceType
	Format   types2.FileFormat
	Path     string
	URL      string
	S3Config *S3OptionConfig
}

type ContextProviderFunc func(ctx context.Context) context.Context

type TxSQLAdapter struct {
	sqlAdapter      SQLAdapter
	tx              *TxWrapper
	contextProvider ContextProviderFunc
}

func (tx *TxSQLAdapter) TmpNamespace(targetNamespace string) string {
	return tx.sqlAdapter.TmpNamespace(targetNamespace)
}

func (tx *TxSQLAdapter) TmpTableUsePK() bool {
	return tx.sqlAdapter.TmpTableUsePK()
}

func (tx *TxSQLAdapter) DefaultNamespace() string {
	return tx.sqlAdapter.DefaultNamespace()
}

func (tx *TxSQLAdapter) Type() string {
	return tx.sqlAdapter.Type()
}

func (tx *TxSQLAdapter) GetBatchFileFormat() types2.FileFormat {
	return tx.sqlAdapter.GetBatchFileFormat()
}

func (tx *TxSQLAdapter) GetBatchFileCompression() types2.FileCompression {
	return tx.sqlAdapter.GetBatchFileCompression()
}

func (tx *TxSQLAdapter) StringifyObjects() bool {
	return tx.sqlAdapter.StringifyObjects()
}

func (tx *TxSQLAdapter) GetSQLType(dataType types2.DataType) (string, bool) {
	return tx.sqlAdapter.GetSQLType(dataType)
}

func (tx *TxSQLAdapter) GetDataType(sqlType string) (types2.DataType, bool) {
	return tx.sqlAdapter.GetDataType(sqlType)
}

func (tx *TxSQLAdapter) GetAvroType(sqlType string) (any, bool) {
	return tx.sqlAdapter.GetAvroType(sqlType)
}

func (tx *TxSQLAdapter) GetAvroSchema(table *Table) *types2.AvroSchema {
	return tx.sqlAdapter.GetAvroSchema(table)
}

func (tx *TxSQLAdapter) OpenTx(ctx context.Context) (*TxSQLAdapter, error) {
	return nil, fmt.Errorf("can't open transaction inside transaction")
}
func (tx *TxSQLAdapter) Insert(ctx context.Context, table *Table, merge bool, objects ...types2.Object) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Insert(ctx, table, merge, objects...)
}
func (tx *TxSQLAdapter) Ping(ctx context.Context) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Ping(ctx)
}
func (tx *TxSQLAdapter) InitDatabase(ctx context.Context) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.InitDatabase(ctx)
}

func (tx *TxSQLAdapter) TableHelper() *TableHelper {
	return tx.sqlAdapter.TableHelper()
}

func (tx *TxSQLAdapter) GetTableSchema(ctx context.Context, namespace string, tableName string) (*Table, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.GetTableSchema(ctx, namespace, tableName)
}
func (tx *TxSQLAdapter) CreateTable(ctx context.Context, schemaToCreate *Table) (*Table, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.CreateTable(ctx, schemaToCreate)
}
func (tx *TxSQLAdapter) CopyTables(ctx context.Context, targetTable *Table, sourceTable *Table, mergeWindow int, discriminatorColumn string) (bulker.WarehouseState, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.CopyTables(ctx, targetTable, sourceTable, mergeWindow, discriminatorColumn)
}
func (tx *TxSQLAdapter) LoadTable(ctx context.Context, targetTable *Table, loadSource *LoadSource) (bulker.WarehouseState, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.LoadTable(ctx, targetTable, loadSource)
}
func (tx *TxSQLAdapter) PatchTableSchema(ctx context.Context, patchTable *Table) (*Table, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.PatchTableSchema(ctx, patchTable)
}
func (tx *TxSQLAdapter) TruncateTable(ctx context.Context, namespace string, tableName string) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.TruncateTable(ctx, namespace, tableName)
}

//	func (tx *TxSQLAdapter) Update(ctx context.Context, tableName string, object types.Object, whenConditions *WhenConditions) error {
//		ctx = tx.enrichContext(ctx)
//		return tx.sqlAdapter.Update(ctx, tableName, object, whenConditions)
//	}
func (tx *TxSQLAdapter) Delete(ctx context.Context, namespace string, tableName string, deleteConditions *WhenConditions) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Delete(ctx, namespace, tableName, deleteConditions)
}
func (tx *TxSQLAdapter) DropTable(ctx context.Context, namespace string, tableName string, ifExists bool) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.DropTable(ctx, namespace, tableName, ifExists)
}
func (tx *TxSQLAdapter) Drop(ctx context.Context, table *Table, ifExists bool) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Drop(ctx, table, ifExists)
}
func (tx *TxSQLAdapter) ReplaceTable(ctx context.Context, targetTableName string, replacementTable *Table, dropOldTable bool) error {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.ReplaceTable(ctx, targetTableName, replacementTable, dropOldTable)
}

func (tx *TxSQLAdapter) Select(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions, orderBy []string) ([]map[string]any, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Select(ctx, namespace, tableName, whenConditions, orderBy)
}
func (tx *TxSQLAdapter) Count(ctx context.Context, namespace string, tableName string, whenConditions *WhenConditions) (int, error) {
	ctx = tx.enrichContext(ctx)
	return tx.sqlAdapter.Count(ctx, namespace, tableName, whenConditions)
}

func (tx *TxSQLAdapter) enrichContext(ctx context.Context) context.Context {
	if tx.contextProvider != nil {
		ctx = tx.contextProvider(ctx)
	}
	ctx = context.WithValue(ctx, ContextTransactionKey, tx.tx)
	return ctx
}

func (tx *TxSQLAdapter) Commit() error {
	return tx.tx.Commit()
}

func (tx *TxSQLAdapter) Rollback() error {
	return tx.tx.Rollback()
}

func (tx *TxSQLAdapter) ColumnName(identifier string) string {
	return tx.sqlAdapter.ColumnName(identifier)
}

func (tx *TxSQLAdapter) TableName(identifier string) string {
	return tx.sqlAdapter.TableName(identifier)
}

func (tx *TxSQLAdapter) NamespaceName(namespace string) string {
	return tx.sqlAdapter.NamespaceName(namespace)
}

func (tx *TxSQLAdapter) DoLocalDeduplication() bool {
	return tx.sqlAdapter.DoLocalDeduplication()
}
