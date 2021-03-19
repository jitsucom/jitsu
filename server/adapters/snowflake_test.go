package adapters

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestReformatValue(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"empty input string",
			``,
			``,
		},
		{
			"begin with number",
			`0st`,
			`"0st"`,
		},
		{
			"begin with underscore",
			`_dn`,
			`_dn`,
		},
		{
			"begin with dollar",
			`$qq`,
			`"$qq"`,
		},
		{
			"begin with letter",
			`io`,
			`io`,
		},
		{
			"doesn't contain extended characters",
			`_tableName123$`,
			`_tableName123$`,
		},
		{
			"contains extended characters",
			`my.identifier`,
			`"my.identifier"`,
		},
		{
			"contains spaces",
			`abc bbb`,
			`"abc bbb"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, reformatValue(tt.input), "Reformatted values aren't equal")
		})
	}
}

func TestReformatToParam(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			"empty input string",
			``,
			``,
		},
		{
			"quoted",
			`"value"`,
			`value`,
		},
		{
			"unquoted",
			`value`,
			`VALUE`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			require.Equal(t, tt.expected, reformatToParam(tt.input), "Reformatted to param values aren't equal")
		})
	}
}
