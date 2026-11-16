package kafkabase

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/confluentinc/confluent-kafka-go/v2/kafka"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/require"
)

func TestProduceAsyncAcceptsOnlySuccessfulFailover(t *testing.T) {
	cluster, err := kafka.NewMockCluster(1)
	require.NoError(t, err)
	defer cluster.Close()
	require.NoError(t, cluster.SetBrokerDown(1))

	for _, tc := range []struct {
		name        string
		logger      bool
		failover    bool
		closeLogger bool
		closeFile   bool
		wantError   string
	}{
		{name: "saved", logger: true, failover: true},
		{name: "disabled", failover: true, wantError: "Queue full"},
		{name: "not opted in", logger: true, wantError: "Queue full"},
		{name: "logger closed", logger: true, failover: true, closeLogger: true, wantError: "failover logger is closed"},
		{name: "write failed", logger: true, failover: true, closeFile: true, wantError: "failover write failed"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, err := NewProducer(&KafkaConfig{}, &kafka.ConfigMap{
				"bootstrap.servers":            cluster.BootstrapServers(),
				"queue.buffering.max.messages": 1,
			}, false, nil)
			require.NoError(t, err)
			// No event loop is needed: these tests exercise immediate rejection.
			defer p.producer.Close()
			if tc.logger {
				p.failoverLogger, err = NewFailoverLogger(&FailoverLoggerConfig{
					Enabled: true, BasePath: t.TempDir(),
				})
				require.NoError(t, err)
				defer p.failoverLogger.Close()
				if tc.closeLogger {
					require.NoError(t, p.failoverLogger.Close())
				}
				if tc.closeFile {
					require.NoError(t, p.failoverLogger.currentFile.Close())
				}
			}

			require.NoError(t, p.ProduceAsync("pipeline", "", []byte(`{"queued":true}`), nil, kafka.PartitionAny, "", false, 0))
			errorCounter := p.metrics.messages(p.metricsLabelFunc("pipeline", "error", KafkaErrorCode(kafka.NewError(kafka.ErrQueueFull, "", false))))
			producedCounter := p.metrics.messages(p.metricsLabelFunc("pipeline", "produced", ""))
			beforeErrors, beforeProduced := testutil.ToFloat64(errorCounter), testutil.ToFloat64(producedCounter)
			payload := []byte(`{"messageId":"overflow"}`)
			err = p.ProduceAsync("pipeline", "", payload, nil, kafka.PartitionAny, "", tc.failover, 0)
			if tc.wantError == "" {
				require.NoError(t, err)
				content, err := os.ReadFile(p.failoverLogger.currentFile.Name())
				require.NoError(t, err)
				require.Equal(t, string(payload)+"\n", string(content))
			} else {
				require.ErrorContains(t, err, tc.wantError)
				var kafkaErr kafka.Error
				require.ErrorAs(t, err, &kafkaErr)
				require.Equal(t, kafka.ErrQueueFull, kafkaErr.Code())
				if tc.closeFile {
					require.ErrorIs(t, err, os.ErrClosed)
				}
			}
			require.Equal(t, beforeErrors+1, testutil.ToFloat64(errorCounter))
			require.Equal(t, beforeProduced, testutil.ToFloat64(producedCounter), "failover is not a successful Kafka enqueue")
		})
	}
}

func TestUnavailableFailoverLoggerDoesNotReportSuccess(t *testing.T) {
	var logger *FailoverLogger
	require.Error(t, logger.LogPayload([]byte(`{"event":"test"}`)))
}

type failingFailoverFile struct {
	*os.File
	writes       int
	failWrite    int
	failRollback bool
}

var errInjectedWrite = errors.New("injected storage failure")

func (f *failingFailoverFile) Write(data []byte) (int, error) {
	f.writes++
	if f.writes == f.failWrite {
		n, err := f.File.Write(data[:len(data)/2])
		if err != nil {
			return n, err
		}
		return n, errInjectedWrite
	}
	return f.File.Write(data)
}

func (f *failingFailoverFile) Truncate(size int64) error {
	if f.failRollback {
		return errInjectedWrite
	}
	return f.File.Truncate(size)
}

func TestFailoverAppendFailurePreservesRecordBoundaries(t *testing.T) {
	for _, tc := range []struct {
		name         string
		failWrite    int
		failRollback bool
	}{
		{name: "partial payload", failWrite: 1},
		{name: "missing newline", failWrite: 2},
		{name: "rollback fails", failWrite: 2, failRollback: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			logger, err := NewFailoverLogger(&FailoverLoggerConfig{Enabled: true, BasePath: t.TempDir()})
			require.NoError(t, err)
			defer logger.Close()
			first := `{"event":"already saved"}`
			// Simulate existing file contents not tracked by currentSize.
			_, err = logger.currentFile.Write([]byte(first + "\n"))
			require.NoError(t, err)
			file := &failingFailoverFile{
				File: logger.currentFile.(*os.File), failWrite: tc.failWrite, failRollback: tc.failRollback,
			}
			logger.currentFile = file
			require.ErrorIs(t, logger.LogPayload([]byte(`{"event":"failed"}`)), errInjectedWrite)
			file.failRollback = false
			last := `{"event":"next"}`
			if tc.failRollback {
				// Even after storage recovers, this logger must not acknowledge
				// more events once it failed to restore a clean file boundary.
				before, err := os.ReadFile(file.Name())
				require.NoError(t, err)
				require.ErrorContains(t, logger.LogPayload([]byte(last)), "failed to roll back")
				after, err := os.ReadFile(file.Name())
				require.NoError(t, err)
				require.Equal(t, before, after)
				return
			}
			require.NoError(t, logger.LogPayload([]byte(last)))
			content, err := os.ReadFile(file.Name())
			require.NoError(t, err)
			require.Equal(t, first+"\n"+last+"\n", string(content))
			for _, line := range strings.Split(strings.TrimSpace(string(content)), "\n") {
				require.True(t, json.Valid([]byte(line)), "accepted events must remain replayable")
			}
		})
	}
}
