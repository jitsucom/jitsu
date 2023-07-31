package errorj

import (
	"github.com/joomcode/errorx"
)

var (
	// ReportedErrors is an error namespace for reporting errors with codes namespace for general purpose errors designed for universal use.
	reportedErrors = errorx.NewNamespace("report")

	sqlError                  = reportedErrors.NewType("sql")
	BeginTransactionError     = sqlError.NewSubtype("begin_transaction")
	CommitTransactionError    = sqlError.NewSubtype("commit_transaction")
	RollbackTransactionError  = sqlError.NewSubtype("rollback_transaction")
	CreateSchemaError         = sqlError.NewSubtype("create_schema")
	CreateTableError          = sqlError.NewSubtype("create_table")
	PatchTableError           = sqlError.NewSubtype("patch_table")
	GetTableError             = sqlError.NewSubtype("get_table")
	DropError                 = sqlError.NewSubtype("drop_table")
	RenameError               = sqlError.NewSubtype("rename_table")
	CreatePrimaryKeysError    = sqlError.NewSubtype("create_primary_keys")
	DeletePrimaryKeysError    = sqlError.NewSubtype("delete_primary_keys")
	GetPrimaryKeysError       = sqlError.NewSubtype("get_primary_keys")
	DeleteFromTableError      = sqlError.NewSubtype("delete_from_table")
	ExecuteInsertInBatchError = sqlError.NewSubtype("execute_insert_in_batch")
	ExecuteInsertError        = sqlError.NewSubtype("execute_insert")
	UpdateError               = sqlError.NewSubtype("update")
	TruncateError             = sqlError.NewSubtype("truncate")
	BulkMergeError            = sqlError.NewSubtype("bulk_merge")
	CopyError                 = sqlError.NewSubtype("copy")

	stageErr             = reportedErrors.NewType("stage")
	SaveOnStageError     = stageErr.NewSubtype("save_on_stage")
	DeleteFromStageError = stageErr.NewSubtype("delete_from_stage")

	innerError             = reportedErrors.NewType("inner")
	ManageMySQLPrimaryKeys = innerError.NewSubtype("manage_mysql_primary_keys")

	DBInfo          = errorx.RegisterPrintableProperty("db_info")
	DBObjects       = errorx.RegisterPrintableProperty("db_objects")
	SystemErrorFlag = errorx.RegisterPrintableProperty("system_error")

	DestinationID   = errorx.RegisterPrintableProperty("destination_id")
	DestinationType = errorx.RegisterPrintableProperty("destination_type")
)

/*
func Wrap(err error, errorType *errorx.Type, message, propertyKey string, property interface{}) *errorx.Error{
	return errorType.Wrap(err, message).
		WithProperty(propertyKey, property)
}*/

func Decorate(err error, msg string, args ...interface{}) *errorx.Error {
	return errorx.Decorate(err, msg, args...)
}

//Group multiple errors where first one is a main error
func Group(errs ...error) error {
	if len(errs) == 0 {
		return nil
	}

	if len(errs) == 1 {
		return errs[0]
	}

	mainErr := errs[0]
	suppressed := errs[1:]

	return errorx.Cast(mainErr).WithUnderlyingErrors(suppressed...)
}

func IsSystemError(err error) bool {
	flag, ok := errorx.Cast(err).Property(SystemErrorFlag)
	if ok {
		b, ok := flag.(bool)
		if ok && b {
			return true
		}
	}

	return false
}
