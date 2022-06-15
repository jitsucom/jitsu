package meta

import (
	"github.com/gomodule/redigo/redis"
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
			em.metricFunc("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			em.metricFunc("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			em.metricFunc("ERR_TIMEOUT")
		} else {
			em.metricFunc("UNKNOWN")
		}
	}
}
