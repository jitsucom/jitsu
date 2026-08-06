package main

import (
	"fmt"
	"sync"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

// stubRepository is enough to be stored in the map; the concurrency being tested
// is the map's, not the repository's.
type stubRepository struct {
	appbase.Repository[[]byte]
	closed bool
}

func (s *stubRepository) Close() error {
	s.closed = true
	return nil
}

// RepositoryHandler registers lazily discovered repositories from request
// goroutines while /health ranges over the map. On a plain map that combination
// aborts the process with "concurrent map read and map write". Run with -race.
func TestRepositoriesConcurrentAddAndSnapshot(t *testing.T) {
	reps := newRepositories()
	reps.add("preloaded", &stubRepository{})

	const goroutines = 16
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(i int) { // writers, as the lazy-init path does
			defer wg.Done()
			reps.add(fmt.Sprintf("rep-%d", i), &stubRepository{})
		}(i)
		wg.Add(1)
		go func() { // readers, as /health does
			defer wg.Done()
			for name, rep := range reps.snapshot() {
				if rep == nil {
					t.Errorf("nil repository for %s", name)
				}
			}
		}()
		wg.Add(1)
		go func(i int) { // point lookups, as RepositoryHandler does
			defer wg.Done()
			reps.get(fmt.Sprintf("rep-%d", i))
		}(i)
	}
	wg.Wait()

	if got := len(reps.snapshot()); got != goroutines+1 {
		t.Errorf("got %d repositories, want %d", got, goroutines+1)
	}
}

// Two requests for the same unknown repository each build one. Exactly one may
// win, and the caller has to be told it lost so it can close the loser instead
// of leaving it refreshing forever.
func TestAddIfAbsentKeepsOneWinner(t *testing.T) {
	reps := newRepositories()

	const goroutines = 8
	var wg sync.WaitGroup
	winners := make([]bool, goroutines)
	built := make([]*stubRepository, goroutines)
	start := make(chan struct{})
	for i := 0; i < goroutines; i++ {
		built[i] = &stubRepository{}
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			existing, stored := reps.addIfAbsent("contended", built[i])
			winners[i] = stored
			if !stored {
				_ = built[i].Close()
				if existing == nil {
					t.Error("addIfAbsent returned no repository for the loser")
				}
			}
		}(i)
	}
	close(start)
	wg.Wait()

	won := 0
	for i, w := range winners {
		if w {
			won++
			if built[i].closed {
				t.Error("the winning repository was closed")
			}
		} else if !built[i].closed {
			t.Error("a losing repository was left open")
		}
	}
	if won != 1 {
		t.Errorf("got %d winners, want exactly 1", won)
	}
	if got := len(reps.snapshot()); got != 1 {
		t.Errorf("map holds %d entries, want 1", got)
	}
}
