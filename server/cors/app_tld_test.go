package cors

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestRule(t *testing.T) {
	tests := []struct {
		name        string
		expression  string
		inputHost   string
		inputOrigin string
		expected    bool
	}{
		{
			"Empty expression",
			"",
			"myhost.com",
			"http://app.mydomain.com",
			false,
		},
		{
			"localhost rule and host is specified",
			"localhost",
			"myhost.com",
			"http://app.mydomain.com",
			false,
		},
		{
			"localhost rule and host local",
			"localhost",
			"localhost:7000",
			"http://localhost:7000",
			true,
		},
		{
			"Origin doesn't match",
			"mydomain.com",
			"myhost.com",
			"http://app.mydomain.com",
			false,
		},
		{
			"Origin matches",
			"*mydomain.com",
			"myhost.com",
			"http://app.mydomain.com",
			true,
		},
		{
			"App TLD Origin doesn't match",
			"{{APP_TLD}}",
			"myhost.com",
			"http://app.mydomain.com",
			false,
		},
		{
			"App TLD Origin matches",
			"{{APP_TLD}}",
			"mydomain.com",
			"http://mydomain.com",
			true,
		},
		{
			"App TLD Origin matches with domain",
			"{{APP_TLD}}",
			"mydomain.com",
			"http://app.mydomain.com",
			true,
		},
		{
			"App TLD second Origin doesn't match",
			"*.{{APP_TLD}}",
			"mydomain.com",
			"http://mydomain.com",
			false,
		},
		{
			"App TLD second Origin matches",
			"*.{{APP_TLD}}",
			"app.mydomain.com",
			"http://app.mydomain.com",
			true,
		},
		{
			"App TLD second Origin matches 2",
			"*.{{APP_TLD}}",
			"app-api.jitsu.com",
			"https://cloud.jitsu.com",
			true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rule := NewRule(tt.expression)
			result := rule.IsAllowed(tt.inputHost, tt.inputOrigin)
			require.Equal(t, tt.expected, result, "Rule [%s] is expected to return %v on (host: %s, origin: %s)", tt.expression, tt.expected, tt.inputHost, tt.inputOrigin)
		})
	}
}

func TestExtractTopLevelAndDomain(t *testing.T) {
	tests := []struct {
		name                   string
		inputAddr              string
		expectedTopLevelDomain string
		expectedDomain         string
	}{
		{
			"Empty expression",
			"",
			"",
			"",
		},
		{
			"inputAddr is a localhost",
			"localhost",
			"localhost",
			"",
		},
		{
			"inputAddr is a top level domain",
			"mydomain.com",
			"mydomain.com",
			"",
		},
		{
			"inputAddr is a second level domain",
			"app.mydomain.com",
			"mydomain.com",
			"app",
		},
		{
			"inputAddr is a third level domain",
			"super.app.mydomain.com",
			"mydomain.com",
			"app",
		},
		{
			"inputAddr is a forth level domain",
			"mega.super.app.mydomain.com",
			"mydomain.com",
			"app",
		},
		{
			"expression with TLD",
			"{{APP_TLD}}",
			"{{APP_TLD}}",
			"",
		},
		{
			"expression with *.TLD",
			"*.{{APP_TLD}}",
			"{{APP_TLD}}",
			"*",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualTld, actualDomain := ExtractTopLevelAndDomain(tt.inputAddr)
			require.Equal(t, tt.expectedTopLevelDomain, actualTld, "Actual top level domain [%s] isn't equal to expected one [%s]", actualTld, tt.expectedTopLevelDomain)
			require.Equal(t, tt.expectedDomain, actualDomain, "Actual domain [%s] isn't equal to expected one [%s]", actualDomain, tt.expectedDomain)
		})
	}
}
