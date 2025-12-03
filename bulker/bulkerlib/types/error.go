package types

import (
	"fmt"
	"strings"

	"github.com/jitsucom/bulker/jitsubase/utils"
)

type BatchErrorEventStatus struct {
	Index       int
	Description string
	Payload     []byte
	Retriable   bool
}
type BatchError struct {
	Type         string
	Code         int
	Description  string
	SuccessCount int
	FailedCount  int
	Errors       []BatchErrorEventStatus
}

func (be *BatchError) Error() string {
	return be.Description
}

func (be *BatchError) FullError() string {
	if len(be.Errors) == 0 {
		return be.Description
	}
	var builder strings.Builder
	builder.WriteString(fmt.Sprintf("%s:\n\n", be.Description))
	for _, failedRecord := range be.Errors {
		builder.WriteString(failedRecord.Description)
		builder.WriteString("Event:\n")
		builder.Write(failedRecord.Payload)
		builder.WriteString("\n\n")
	}
	return builder.String()
}

type ErrorPayload struct {
	Dataset         string
	Bucket          string
	Project         string
	Database        string
	Cluster         string
	Schema          string
	Table           string
	Partition       string
	PrimaryKeys     []string
	Statement       string
	Values          []any
	ValuesMapString string
	TotalObjects    int
}

func (ep *ErrorPayload) String() string {
	var msgParts []string
	if ep.Dataset != "" {
		msgParts = append(msgParts, fmt.Sprintf("dataset: %s", ep.Dataset))
	}
	if ep.Bucket != "" {
		msgParts = append(msgParts, fmt.Sprintf("bucket: %s", ep.Bucket))
	}
	if ep.Project != "" {
		msgParts = append(msgParts, fmt.Sprintf("project: %s", ep.Project))
	}
	if ep.Database != "" {
		msgParts = append(msgParts, fmt.Sprintf("database: %s", ep.Database))
	}
	if ep.Cluster != "" {
		msgParts = append(msgParts, fmt.Sprintf("cluster: %s", ep.Cluster))
	}
	if ep.Schema != "" {
		msgParts = append(msgParts, fmt.Sprintf("schema: %s", ep.Schema))
	}
	if ep.Table != "" {
		msgParts = append(msgParts, fmt.Sprintf("table: %s", ep.Table))
	}
	if ep.Partition != "" {
		msgParts = append(msgParts, fmt.Sprintf("partition: %s", ep.Partition))
	}
	if len(ep.PrimaryKeys) > 0 {
		msgParts = append(msgParts, fmt.Sprintf("primary keys: %v", ep.PrimaryKeys))
	}
	if ep.Statement != "" {
		msgParts = append(msgParts, fmt.Sprintf("statement: %s", utils.ShortenStringWithEllipsis(ep.Statement, 10000)))
	}
	if len(ep.Values) > 0 {
		msgParts = append(msgParts, fmt.Sprintf("values: %v", ep.Values))
	}
	if ep.TotalObjects > 1 {
		msgParts = append(msgParts, fmt.Sprintf("objects count: %d", ep.TotalObjects))
	}
	if ep.ValuesMapString != "" {
		msgParts = append(msgParts, fmt.Sprintf("values of 1st object: %s", ep.ValuesMapString))
	}
	if len(msgParts) > 0 {
		return "\n" + strings.Join(msgParts, "\n") + "\n"
	} else {
		return ""
	}
}

func ObjectValuesToString(header []string, valueArgs []any) string {
	var firstObjectValues strings.Builder
	firstObjectValues.WriteString("{")
	for i, name := range header {
		if i != 0 {
			firstObjectValues.WriteString(", ")
		}
		firstObjectValues.WriteString(name + ": " + fmt.Sprint(valueArgs[i]))
	}
	firstObjectValues.WriteString("}")
	return firstObjectValues.String()
}
