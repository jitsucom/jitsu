package queue

import (
	"encoding/json"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

const (
	DestinationNamespace = "destination"
	HTTPAdapterNamespace = "http"

	eventsQueueKeyPrefix      = "events_queue:%s#%s"
	defaultWaitTimeoutSeconds = 1
)

//redis key [variables] - description
//** Events queue**
//events_queue:destination#$destinationID - list with destination event JSON's
//events_queue:http#$destinationID - list with destinations adapters http requests

//Redis is a queue implementation based on Redis
//it is used blocking pop (BLPOP) command for getting elements from queue
type Redis struct {
	identifier                string
	queueKey                  string
	serializationModelBuilder func() interface{}

	waitTimeoutSeconds int

	sharedPool   *meta.RedisPool
	errorMetrics *meta.ErrorMetrics

	bufferQueue *ConcurrentLinkedQueue

	closed chan struct{}
}

func NewRedis(namespace, identifier string, redisPool *meta.RedisPool, serializationModelBuilder func() interface{},
	redisReadTimeout time.Duration) Queue {
	//wait timeout should be less than read timeout
	//waitTimeoutSeconds := int(redisReadTimeout.Seconds() * 0.3)
	//if waitTimeoutSeconds == 0 {
	waitTimeoutSeconds := defaultWaitTimeoutSeconds
	//}

	r := &Redis{
		identifier:                identifier,
		queueKey:                  fmt.Sprintf(eventsQueueKeyPrefix, namespace, identifier),
		serializationModelBuilder: serializationModelBuilder,
		waitTimeoutSeconds:        waitTimeoutSeconds,
		sharedPool:                redisPool,
		errorMetrics:              meta.NewErrorMetrics(metrics.EventsRedisErrors),
		bufferQueue:               NewConcurrentLinkedQueue(1_000_000),
		closed:                    make(chan struct{}),
	}
	safego.RunWithRestart(r.processBuffer)
	return r
}

func (r *Redis) Push(v interface{}) error {
	select {
	case <-r.closed:
		return ErrQueueClosed
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Errorf("error serializing %v into json: %v", v, err)
		}
		return r.bufferQueue.Enqueue(string(b))
	}
}

func (r *Redis) processBuffer() {
	for {
		v, err := r.bufferQueue.Dequeue()
		if err != nil {
			if err == ErrQueueClosed {
				return
			}
			logging.SystemErrorf("Redis queue %s Error dequeueing from buffer queue: %v", r.identifier, err)
			time.Sleep(10 * time.Second)
		}
	Cycle:
		for {
			select {
			case <-r.closed:
				return
			default:
				err = r.rpush(v.(string))
				if err != nil {
					time.Sleep(10 * time.Second)
				} else {
					break Cycle
				}
			}
		}
	}
}

func (r *Redis) Pop() (interface{}, error) {
	for {
		select {
		case <-r.closed:
			return nil, ErrQueueClosed
		default:
			value, err := r.blpop()
			if err != nil {
				if err == ErrQueueEmpty {
					continue
				}

				return nil, err
			}

			model := r.serializationModelBuilder()
			if err := json.Unmarshal([]byte(value), model); err != nil {
				return nil, fmt.Errorf("error deserializing %v into %T: %v", value, model, err)
			}

			return model, nil
		}
	}
}

func (r *Redis) Size() int64 {
	conn := r.sharedPool.Get()
	defer conn.Close()

	size, err := redis.Int64(conn.Do("LLEN", r.queueKey))
	if err != nil {
		if err == redis.ErrNil {
			return 0
		}

		r.errorMetrics.NoticeError(err)
		return -1
	}

	return size
}

func (r *Redis) BufferSize() int64 {
	return int64(r.bufferQueue.GetSize())
}

func (r *Redis) Type() string {
	return RedisType
}

//Close doesn't close sharedPool
func (r *Redis) Close() error {
	close(r.closed)
	r.bufferQueue.Close()
	return nil
}

func (r *Redis) blpop() (string, error) {
	conn := r.sharedPool.Get()
	defer conn.Close()

	v, err := redis.Values(conn.Do("BLPOP", r.queueKey, r.waitTimeoutSeconds))
	if err != nil {
		if err == redis.ErrNil {
			return "", ErrQueueEmpty
		}

		r.errorMetrics.NoticeError(err)
		return "", err
	}

	if len(v) != 2 {
		return "", fmt.Errorf("malformed redis response: %v", v)
	}

	return redis.String(v[1], nil)
}

func (r *Redis) rpush(value string) error {
	conn := r.sharedPool.Get()
	defer conn.Close()

	_, err := conn.Do("RPUSH", r.queueKey, value)
	if err != nil {
		if err == redis.ErrNil {
			return nil
		}

		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}
