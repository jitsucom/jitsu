package storages

import (
	"github.com/jitsucom/eventnative/schema"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestBuildDataIntoFileName(t *testing.T) {
	tests := []struct {
		name             string
		inputPf          *schema.ProcessedFile
		inputRowsCount   int
		expectedFileName string
	}{
		{
			"empty",
			&schema.ProcessedFile{
				FileName:   "",
				DataSchema: &schema.Table{Name: ""},
			},
			0,
			"-rows-0-table-",
		},
		{
			"full",
			&schema.ProcessedFile{
				FileName:   "file1-part1-part2.token1value",
				DataSchema: &schema.Table{Name: "table1"},
			},
			200,
			"file1-part1-part2.token1value-rows-200-table-table1",
		},
		{
			"production format",
			&schema.ProcessedFile{
				FileName:   "host.com-event-2jjhdsya-daknfibw-dajnsda-iueyrbfnf.log",
				DataSchema: &schema.Table{Name: "table1"},
			},
			200,
			"host.com-event-2jjhdsya-daknfibw-dajnsda-iueyrbfnf.log-rows-200-table-table1",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualFileName := buildDataIntoFileName(tt.inputPf, tt.inputRowsCount)
			require.Equal(t, tt.expectedFileName, actualFileName, "Result file names aren't equal")
		})
	}
}

func TestExtractDataFromFileName(t *testing.T) {
	tests := []struct {
		name              string
		inputFileName     string
		expectedTableName string
		expectedTokenId   string
		expectedRowsCount int
		expectedErr       string
	}{
		{
			"err table delimiter",
			"",
			"",
			"",
			0,
			"error in tableFileKeyDelimiter part! Right format: $filename-rows-$rowcount-table-$tablename.",
		},
		{
			"err rows delimiter",
			"dandaisnda-table-mytable",
			"",
			"",
			0,
			"error in rowsFileKeyDelimiter part! Right format: $filename-rows-$rowcount-table-$tablename.",
		},
		{
			"err rows count format",
			"file1-part1-part2.token1value-rows-abc-table-table1",
			"",
			"",
			0,
			"error in rows count part! Rows count must be int.",
		},
		{
			"err token part",
			"host.com-event-2jjhdsya-daknfibw-dajnsda-iueyrbfnf.log-rows-2-table-table1",
			"",
			"",
			0,
			"error in token part! Right format: $filename-rows-$rowcount-table-$tablename.",
		},
		{
			"ok",
			"host.com-event-2jjhdsya-daknfibw-dajnsda-iueyrbfnf-2020-10-08T08-50-12.136.log-rows-2-table-table1",
			"table1",
			"2jjhdsya-daknfibw-dajnsda-iueyrbfnf",
			2,
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualTableName, actualTokenId, actualRowsCount, err := extractDataFromFileName(tt.inputFileName)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.expectedTableName, actualTableName, "Table names aren't equal")
				require.Equal(t, tt.expectedTokenId, actualTokenId, "Token ids aren't equal")
				require.Equal(t, tt.expectedRowsCount, actualRowsCount, "Rows counts aren't equal")
			}
		})
	}
}

func TestLinesCount(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			"empty input",
			[]byte(""),
			0,
		},
		{
			"one line",
			[]byte("abcbdsahbda"),
			1,
		},
		{
			"one line with \\n",
			[]byte("abcbdsahbda\n"),
			1,
		},
		{
			"two lines",
			[]byte("abcbdsahbda\n123"),
			2,
		},
		{
			"five lines",
			[]byte("abcbdsahbda\n123\ndsandoas\ndasda\n1"),
			5,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualRowsCount := linesCount(tt.input)
			require.Equal(t, tt.expected, actualRowsCount, "Rows counts aren't equal")
		})
	}
}
