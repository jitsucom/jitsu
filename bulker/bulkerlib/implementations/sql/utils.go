package sql

import (
	"database/sql"
	"math/big"
	"strconv"
	"strings"
	"time"

	"github.com/ClickHouse/clickhouse-go/v2/lib/chcol"
)

type ColumnScanner struct {
	ColumnType *sql.ColumnType
	value      any
}

func (s *ColumnScanner) Scan(src any) error {
	//logging.Debugf("Scanning %s of %s => %v (%T)", s.ColumnType.Name(), s.ColumnType.DatabaseTypeName(), src, src)
	switch v := src.(type) {
	case []byte:
		s.value = string(v)
	case int64:
		if s.ColumnType.DatabaseTypeName() == "TINYINT" && (v == 1 || v == 0) {
			//hack for mysql where boolean is represented as tinyint(1)
			s.value = v == 1
		} else {
			s.value = int(v)
		}
	case uint8:
		if s.ColumnType.DatabaseTypeName() == "UInt8" && (v == 1 || v == 0) {
			//hack for ClickHouse where boolean is represented as UInt8
			s.value = v == 1
		} else {
			s.value = int(v)
		}
	case big.Int:
		s.value = int(v.Int64())
	case *big.Int:
		if v == nil {
			s.value = nil
		} else {
			s.value = int(v.Int64())
		}
	case big.Float:
		s.value, _ = v.Float64()
	case *big.Float:
		if v == nil {
			s.value = nil
		} else {
			s.value, _ = v.Float64()
		}
	case time.Time:
		s.value = v.UTC()
	case *chcol.JSON:
		if len(v.NestedMap()) > 0 {
			b, _ := v.MarshalJSON()
			s.value = string(b)
		} else {
			s.value = nil
		}
	case string:
		nullable, _ := s.ColumnType.Nullable()
		if !nullable && v == "" {
			s.value = nil
		} else {
			s.value = src
		}
	default:
		s.value = src
	}
	return nil
}

func (s *ColumnScanner) Get() any {
	return s.value
}

type ParameterPlaceholder func(i int, name string) string

var IndexParameterPlaceholder = func(i int, name string) string {
	return "$" + strconv.Itoa(i)
}

var QuestionMarkParameterPlaceholder = func(i int, name string) string {
	return "?"
}

var NamedParameterPlaceholder = func(i int, name string) string {
	return "@" + name
}

func rowToMap(rows *sql.Rows) (map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	columnTypes, err := rows.ColumnTypes()
	if err != nil {
		return nil, err
	}
	data := make([]any, len(columns))
	for i := range columns {
		data[i] = &ColumnScanner{ColumnType: columnTypes[i]}
	}
	if err = rows.Scan(data...); err != nil {
		return nil, err
	}
	row := make(map[string]any, len(columns))
	for i, v := range data {
		row[strings.ToLower(columns[i])] = v.(*ColumnScanner).Get()
	}
	return row, nil
}

func removeLastComma(str string) string {
	if last := len(str) - 1; last >= 0 && str[last] == ',' {
		str = str[:last]
	}

	return str
}

// checkErr checks and extracts parsed pq.Error and extract code,message,details
func checkErr(err error) error {
	return err
}
