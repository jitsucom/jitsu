package queue

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/stretchr/testify/assert"
	"go.uber.org/atomic"
	"sync"
	"testing"
	"time"
)

func TestLinkedQueueSingleThread(t *testing.T) {
	queue := NewConcurrentLinkedQueue(1_000_000)
	queue.Enqueue(1)
	assert.Equal(t, uint32(1), queue.GetSize())
	i, err := queue.Dequeue()
	assert.NoError(t, err)
	assert.Equal(t, 1, i)
	queue.Enqueue(2)
	queue.Enqueue(3)
	i, err = queue.Dequeue()
	assert.NoError(t, err)
	assert.Equal(t, 2, i)
	i, err = queue.Dequeue()
	assert.NoError(t, err)
	assert.Equal(t, 3, i)
	assert.Equal(t, uint32(0), queue.GetSize())
	queue.Close()
	err = queue.Enqueue(4)
	if assert.Error(t, err) {
		assert.Equal(t, ErrQueueClosed, err)
	}
	i, err = queue.Dequeue()
	if assert.Error(t, err) {
		assert.Equal(t, ErrQueueClosed, err)
	}
}

func TestLinkedQueueMultiThread(t *testing.T) {
	tests := []struct {
		producersCount  int
		consumersCount  int
		elementsToAdd   int
		producerPauseMs int
		queueSize       int
	}{
		{4, 10, 1000000, 0, 1000},
		{1, 10, 10000, 0, 10},
		{10, 1, 1000, 0, 10000},
		{10, 4, 1000000, 0, 1000},
		{6, 10, 12000, 1, 100},
		{1, 10, 1000, 1, 2},
		{3, 3, 900, 0, 1},
		{10, 1, 100, 1, 3},
		{20, 4, 100000, 1, 10},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("%d events by %d producers => %d consumers", tt.elementsToAdd, tt.producersCount, tt.consumersCount), func(t *testing.T) {
			testLinkedQueue(t, tt.producersCount, tt.consumersCount, tt.elementsToAdd, tt.producerPauseMs, tt.queueSize)
		})
	}
}

func testLinkedQueue(t *testing.T, producersCount int, consumersCount int, elementsToAdd int, producerPauseMs int, queueSize int) {
	if elementsToAdd%producersCount != 0 {
		t.Errorf("elementsToAdd must be divisible by producersCount")
		return
	}
	//sum or arithmetic progression
	expectedResult := (1 + elementsToAdd) * elementsToAdd / 2
	producedNumber := atomic.NewInt64(0)
	consumedCount := atomic.NewInt64(0)
	sum := atomic.NewInt64(0)

	queue := NewConcurrentLinkedQueue(uint32(queueSize))
	for i := 0; i < producersCount; i++ {
		go func() {
			for i := 0; i < elementsToAdd/producersCount; i++ {
				err := queue.Enqueue(producedNumber.Add(1))
				if err != nil {
					t.Errorf("Error enqueuing: %v", err)
					return
				}
				if producerPauseMs > 0 {
					time.Sleep(time.Duration(producerPauseMs) * time.Millisecond)
				}
			}
		}()
	}
	var wg sync.WaitGroup
	for i := 0; i < consumersCount; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				if consumedCount.Load() == int64(elementsToAdd) {
					assert.Equal(t, uint32(0), queue.GetSize())
					queue.Close()
					return
				}
				v, err := queue.Dequeue()
				if err != nil {
					if err == ErrQueueClosed {
						return
					}
					t.Errorf("Error dequeueing from queue: %v", err)
					return
				}
				sum.Add(v.(int64))
				consumedCount.Add(1)

			}
		}()
	}
	wg.Wait()
	logging.Infof("Result: %d Expected: %d", sum.Load(), expectedResult)
	assert.Equal(t, int64(expectedResult), sum.Load())
}
