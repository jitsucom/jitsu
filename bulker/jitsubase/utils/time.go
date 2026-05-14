package utils

import "time"

type Ticker struct {
	ticker *time.Ticker
	d      time.Duration
	C      chan time.Time
	Closed chan struct{}
}

func NewTicker(d time.Duration, startDelay time.Duration) *Ticker {
	c := make(chan time.Time, 1)
	closed := make(chan struct{})
	t := &Ticker{
		d:      d,
		C:      c,
		Closed: closed,
	}
	t.start(startDelay)
	return t
}

// start
func (t *Ticker) start(startDelay time.Duration) {
	go func() {
		if startDelay != t.d {
			select {
			case tm := <-time.After(startDelay):
				t.C <- tm
			case <-t.Closed:
				return
			}
		}
		t.ticker = time.NewTicker(t.d)
		for {
			select {
			case tm := <-t.ticker.C:
				t.C <- tm
			case <-t.Closed:
				return
			}
		}
	}()
}

func (t *Ticker) Period() time.Duration {
	return t.d
}

// Stop turns off a ticker. After Stop, no more ticks will be sent.
func (t *Ticker) Stop() {
	t.ticker.Stop()
	close(t.Closed)
}

func MinTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

func MaxTime(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

func MaxTimePtr(a, b *time.Time) *time.Time {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.After(*b) {
		return a
	}
	return b
}

func MinTimePtr(a, b *time.Time) *time.Time {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.Before(*b) {
		return a
	}
	return b
}

type Stopwatch struct {
	startedAt time.Time
	lastLap   time.Time
}

func NewStopwatch() *Stopwatch {
	now := time.Now()
	return &Stopwatch{startedAt: now, lastLap: now}
}

func (s *Stopwatch) ElapsedMs() int64 {
	return time.Since(s.startedAt).Milliseconds()
}

func (s *Stopwatch) LapMs() int64 {
	now := time.Now()
	lap := now.Sub(s.lastLap).Milliseconds()
	s.lastLap = now
	return lap
}
