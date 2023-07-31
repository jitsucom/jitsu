package singer

import (
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"testing"
)

func TestParseSchema(t *testing.T) {
	tests := []struct {
		name          string
		inputFilePath string
		expected      *base.StreamRepresentation
	}{
		{
			"Empty current and input",
			"../../test_data/singer_output_schema.json",
			&base.StreamRepresentation{},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fBytes, err := ioutil.ReadFile(tt.inputFilePath)
			require.NoError(t, err)

			actual, err := parseSchema(fBytes)
			require.NoError(t, err)

			require.Equal(t, typing.INT64, actual.BatchHeader.Fields["vid"].GetType())
			require.Equal(t, typing.STRING, actual.BatchHeader.Fields["property_hs_email_open_value"].GetType())
			require.Equal(t, typing.FLOAT64, actual.BatchHeader.Fields["canonical_vid"].GetType())
			require.Equal(t, []string{"vid"}, actual.KeyFields)
		})
	}
}
