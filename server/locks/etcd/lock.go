package etcd

import (
	"context"
	"errors"
	"github.com/jitsucom/jitsu/server/locks/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	clientv3 "go.etcd.io/etcd/client/v3"
	"go.etcd.io/etcd/client/v3/concurrency"
	"time"
)

const (
	defaultUnlockRetries = 5
)

//Lock is an Etcd lock
type Lock struct {
	name   string
	ctx    context.Context
	client *clientv3.Client

	mutex   *concurrency.Mutex
	session *concurrency.Session
	cancel  context.CancelFunc
}

func newLock(name string, ctx context.Context, client *clientv3.Client) *Lock {
	return &Lock{
		name:   name,
		ctx:    ctx,
		client: client,
	}
}

//Lock obtains lock with wait timeout
func (l *Lock) Lock(timeout time.Duration) error {
	//the session depends on the context. We can't cancel context before unlock.
	session, sessionError := concurrency.NewSession(l.client, concurrency.WithContext(l.ctx))
	if sessionError != nil {
		return sessionError
	}

	ctx, cancel := context.WithDeadline(l.ctx, timestamp.Now().Add(timeout))
	mutex := concurrency.NewMutex(session, l.name)
	if err := mutex.Lock(ctx); err != nil {
		cancel()
		if err == concurrency.ErrLocked {
			return base.ErrAlreadyLocked
		}

		return err
	}

	l.mutex = mutex
	l.session = session
	l.cancel = cancel

	return nil
}

//TryLock tries to obtain a lock with 1 retry without timeout
func (l *Lock) TryLock() error {
	//the session depends on the context. We can't cancel context before unlock.
	session, sessionError := concurrency.NewSession(l.client, concurrency.WithContext(l.ctx))
	if sessionError != nil {
		return sessionError
	}

	mutex := concurrency.NewMutex(session, l.name)
	if err := mutex.TryLock(l.ctx); err != nil {
		if err == concurrency.ErrLocked {
			return base.ErrAlreadyLocked
		}

		return err
	}

	l.mutex = mutex
	l.session = session

	return nil
}

//Unlock tries to unlock with defaultUnlockRetries attempts
func (l *Lock) Unlock() bool {
	ctx, cancel := context.WithTimeout(l.ctx, time.Minute)
	defer cancel()

	i := 0
	for i <= defaultUnlockRetries {
		i++
		err := l.mutex.Unlock(ctx)
		if err != nil {
			logging.SystemErrorf("error unlocking %s after %d attempts: %v", l.name, i, err)
			continue
		}

		return true
	}

	return false
}

//Extend extends the lock expiration
func (l *Lock) Extend() (bool, error) {
	return false, errors.New("Etcd doesn't support Extend() func")
}
