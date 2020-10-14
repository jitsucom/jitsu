package storages

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/schema"
	"strconv"
	"strings"
)

//build file name
//format: $servername-$apikeyid-datetime.log-rows-$intvalue-table-$tablename
func buildDataIntoFileName(fdata *schema.ProcessedFile, rowsCount int) string {
	return fdata.FileName + rowsFileKeyDelimiter + strconv.Itoa(rowsCount) + tableFileKeyDelimiter + fdata.DataSchema.Name
}

//parse file name:
//expected name format: $servername-$apikey-datetime.log-rows-$intvalue-table-$tablename
//return tableName, tokenId, rowsCount, err
func extractDataFromFileName(fileKey string) (string, string, int, error) {
	names := strings.Split(fileKey, tableFileKeyDelimiter)
	if len(names) != 2 {
		return "", "", 0, fmt.Errorf("error in tableFileKeyDelimiter part! Right format: $filename%s$rowcount%s$tablename.", rowsFileKeyDelimiter, tableFileKeyDelimiter)
	}
	fileNameRowsCount := strings.Split(names[0], rowsFileKeyDelimiter)
	if len(fileNameRowsCount) != 2 {
		return "", "", 0, fmt.Errorf("error in rowsFileKeyDelimiter part! Right format: $filename%s$rowcount%s$tablename.", rowsFileKeyDelimiter, tableFileKeyDelimiter)
	}
	rowsStr := fileNameRowsCount[1]
	rowsCount, err := strconv.Atoi(rowsStr)
	if err != nil {
		return "", "", 0, errors.New("error in rows count part! Rows count must be int.")
	}

	regexTokenResult := logging.TokenIdExtractRegexp.FindStringSubmatch(fileNameRowsCount[0])
	if len(regexTokenResult) != 2 {
		return "", "", 0, fmt.Errorf("error in token part! Right format: $filename%s$rowcount%s$tablename.", rowsFileKeyDelimiter, tableFileKeyDelimiter)
	}

	return names[1], regexTokenResult[1], rowsCount, nil
}

//return rows count from byte array
func linesCount(s []byte) int {
	nl := []byte{'\n'}
	n := bytes.Count(s, nl)
	if len(s) > 0 && !bytes.HasSuffix(s, nl) {
		n++
	}
	return n
}
