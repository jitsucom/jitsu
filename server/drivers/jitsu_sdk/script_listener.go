package jitsu_sdk

import (
	"time"
)

type scriptListener chan interface{}

func (l scriptListener) Data(data []byte) {
	l <- data
}

func (l scriptListener) Log(level, message string) {

}

func (l scriptListener) Timeout() time.Duration {
	return time.Hour
}
