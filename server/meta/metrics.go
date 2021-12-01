package meta

import (
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"strings"
)

type ErrorMetrics struct {
	metricFunc func(string)
}

func NewErrorMetrics(metricFunc func(string)) *ErrorMetrics {
	return &ErrorMetrics{metricFunc: metricFunc}
}

func (em *ErrorMetrics) NoticeError(err error) {
	if err != nil {
		if err == redis.ErrPoolExhausted {
			metrics.MetaRedisErrors("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			metrics.MetaRedisErrors("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			metrics.MetaRedisErrors("ERR_TIMEOUT")
		} else {
			metrics.MetaRedisErrors("UNKNOWN")
			logging.Error("Unknown redis error:", err)
		}
	}
}
