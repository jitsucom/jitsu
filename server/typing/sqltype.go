package typing

type SQLTypes map[string]SQLColumn

type SQLColumn struct {
	Type       string
	ColumnType string
}
