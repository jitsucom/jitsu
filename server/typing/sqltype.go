package typing

import "github.com/jitsucom/jitsu/server/utils"

type SQLTypes map[string]SQLColumn

type SQLColumn struct {
	Type       string
	ColumnType string
	Override   bool
}

func (c SQLColumn) DDLType() string {
	return utils.NvlString(c.ColumnType, c.Type)
}
