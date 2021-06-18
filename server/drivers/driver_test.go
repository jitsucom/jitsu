package drivers

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	_ "github.com/jitsucom/jitsu/server/drivers/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/olekukonko/tablewriter"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

const (
	redisDriverConfigVar = "REDIS_DRIVER_CONFIG"
)

func TestSemiAutoDriver(t *testing.T) {
	redisConfig := os.Getenv(redisDriverConfigVar)
	if redisConfig != "" {
		sc := &base.SourceConfig{}
		err := json.Unmarshal([]byte(redisConfig), sc)
		require.NoError(t, err)

		driversMap, err := Create(context.Background(), "test", sc, scheduling.NewCronScheduler())
		require.NoError(t, err)

		defer func() {
			for _, d := range driversMap {
				d.Close()
			}
		}()

		for collection, driver := range driversMap {

			intervals, err := driver.GetAllAvailableIntervals()
			require.NoError(t, err)
			require.NotEmpty(t, intervals)

			objects, err := driver.GetObjectsFor(intervals[0])
			require.NoError(t, err)

			table := tablewriter.NewWriter(os.Stdout)
			var header []string
			headerMap := map[string]bool{}

			for _, object := range objects {
				//update table header
				for k := range object {
					if _, ok := headerMap[k]; !ok {
						header = append(header, k)
						headerMap[k] = true
					}
				}

				//build row
				var row []string
				for _, k := range header {
					v, ok := object[k]
					if !ok {
						v = "null"
					}
					//TODO fix first elements don't know about header quantity
					row = append(row, fmt.Sprint(v))
				}

				//append to table
				table.SetHeader(header)
				table.Append(row)
			}

			fmt.Println(collection)
			table.Render()
		}

	} else {
		logging.Errorf("OS vars configuration doesn't exist")
	}
}
