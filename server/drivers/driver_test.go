package drivers

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/olekukonko/tablewriter"
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

const (
	testDriverConfigVar = "TEST_DRIVER_CONFIG"
)

//TestSemiAutoDriver consumes JSON driver config from testDriverConfigVar
//creates driver and runs sync of first interval
//writes result as a table to stdout
//Note: don't work with Singer drivers
func TestSemiAutoDriver(t *testing.T) {
	sourceConfig := os.Getenv(testDriverConfigVar)
	if sourceConfig == "" {
		logging.Errorf("OS var %q configuration doesn't exist", testDriverConfigVar)
		return
	}

	sc := &base.SourceConfig{}
	err := json.Unmarshal([]byte(sourceConfig), sc)
	require.NoError(t, err)

	driversMap, err := Create(context.Background(), "test", sc, scheduling.NewCronScheduler())
	require.NoError(t, err)

	defer func() {
		for _, d := range driversMap {
			d.Close()
		}
	}()

	for _, driver := range driversMap {
		intervals, err := driver.GetAllAvailableIntervals()
		require.NoError(t, err)
		require.NotEmpty(t, intervals)
		var objects []map[string]interface{}
		objectsLoader := func(o []map[string]interface{}, pos int, total int, percent int) error {
			objects = o
			return nil
		}
		err = driver.GetObjectsFor(intervals[0], objectsLoader)
		require.NoError(t, err)

		resultFile, err := os.Create(fmt.Sprintf("test_output/%s.log", driver.GetCollectionTable()))
		require.NoError(t, err)

		table := tablewriter.NewWriter(resultFile)
		table.SetRowLine(true)
		var header []string
		headerMap := map[string]bool{}

		//collect header
		for _, object := range objects {
			for k := range object {
				if _, ok := headerMap[k]; !ok {
					header = append(header, k)
					headerMap[k] = true
				}
			}
		}
		table.SetHeader(header)

		//build row
		for _, object := range objects {
			var row []string
			for _, k := range header {
				v, ok := object[k]
				if !ok {
					v = "null"
				}

				row = append(row, fmt.Sprint(v))
			}

			//append to table
			table.Append(row)
		}

		resultFile.WriteString("\nTable name: " + driver.GetCollectionTable() + "\n")
		table.Render()
		err = resultFile.Close()
		require.NoError(t, err)
	}
}
