package appconfig

import (
	"github.com/google/go-cmp/cmp"
	"github.com/spf13/viper"
	"os"
	"testing"
)

func TestEnvVarSubstitution(t *testing.T) {
	tests := []struct {
		Name     string
		Envs     map[string]string
		Config   string
		Expected map[string]interface{}
	}{
		{
			"first",
			map[string]string{"URL": "http://localhost:8080", "REDIS_HOST": "localhost"},
			`test_data/config1.yaml`,
			map[string]interface{}{
				"myurl":    "http://localhost:8080",
				"dummy":    "dummy",
				"urls":     []interface{}{"http://localhost:8080"},
				"numbers":  []interface{}{1, 2},
				"config":   map[string]interface{}{"myurl": "http://localhost:8080"},
				"redisurl": "redis://localhost:6379",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.Name, func(t *testing.T) {
			for k, v := range tt.Envs {
				os.Setenv(k, v)
			}
			err := Read(tt.Config, false, "CFG NOT FOUND", "test")
			if err != nil {
				t.Error(err)
				return
			}
			for k, v := range tt.Expected {
				value := viper.Get(k)
				if !cmp.Equal(value, v) {
					t.Errorf("expected %s to be %s, got %s", k, v, value)
				}
			}
		})
	}
}
