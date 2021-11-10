package geo

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParseMaxmindAddress(t *testing.T) {
	tests := []struct {
		name               string
		inputPath          string
		expectedEditions   []Edition
		expectedLicenseKey string
		expectedErr        string
	}{
		{
			"empty input",
			"",
			nil,
			"",
			"",
		},
		{
			"without editions",
			"maxmind://abc",
			nil,
			"abc",
			"",
		},
		{
			"with editions",
			"maxmind://abc?edition_id=GeoIP2-City",
			[]Edition{GeoIP2CityEdition},
			"abc",
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			factory := NewMaxmindFactory("url tempalte")
			licenseKey, editions, err := factory.parseMaxmindAddress(tt.inputPath)
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.expectedLicenseKey, licenseKey)
				require.Equal(t, tt.expectedEditions, editions)
			}
		})
	}
}
