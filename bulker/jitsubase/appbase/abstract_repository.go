package appbase

import (
	"github.com/jitsucom/bulker/jitsubase/safego"
	"io"
	"os"
	"path"
	"sync/atomic"
	"time"
)

type Repository[T any] interface {
	io.Closer
	GetData() *T
	LastSuccess() time.Time
	Loaded() bool
	GetEtag() string
	GetLastModified() time.Time
	ChangesChannel() <-chan bool
}

type RepositoryData[D any] interface {
	Init(reader io.Reader, tag any) error
	GetData() *D
	Store(closer io.Writer) error
}

// NoDataPolicy decides what a repository does when it has no data at all: the
// datasource is unreachable on a cold start and there is no usable cached copy.
type NoDataPolicy int

const (
	// ExitOnNoData aborts the process. For services that would otherwise start
	// serving traffic against empty configuration - an ingest that answers with
	// an empty stream map rejects every event, which is worse than being down.
	ExitOnNoData NoDataPolicy = iota
	// WaitForData keeps retrying on the refresh ticker until the data appears.
	// Loaded() stays false until then, so a consumer picking this MUST gate on
	// it - both to keep itself out of the load balancer and to avoid reading
	// data that is not there yet (GetData returns nil before the first load).
	WaitForData
)

type AbstractRepository[T any] struct {
	Service
	changesChan chan bool
	// refreshPeriodSec refresh period in seconds. If 0 - long polling is used
	refreshPeriodSec int
	inited           atomic.Bool
	cacheDir         string
	dataSource       RepositoryDataLoader
	attempts         int
	data             RepositoryData[T]
	lastSuccess      atomic.Pointer[time.Time]
	tag              atomic.Pointer[any]
	noDataPolicy     NoDataPolicy
	closed           chan struct{}
}

// RepositoryDataLoader loads data from external source. tag can be used for etag or last modified handling
type RepositoryDataLoader func(tag any) (reader io.ReadCloser, newTag any, modified bool, err error)

func NewAbstractRepository[T any](id string, emptyData RepositoryData[T], source RepositoryDataLoader, attempts int, refreshPeriodSec int, cacheDir string, noDataPolicy NoDataPolicy) *AbstractRepository[T] {
	base := NewServiceBase(id)
	if attempts <= 0 {
		attempts = 1
	}
	r := &AbstractRepository[T]{
		Service:          base,
		refreshPeriodSec: refreshPeriodSec,
		changesChan:      make(chan bool, 1),
		cacheDir:         cacheDir,
		dataSource:       source,
		attempts:         attempts,
		data:             emptyData,
		noDataPolicy:     noDataPolicy,
		closed:           make(chan struct{}),
	}
	return r
}

// noDataf reports that the repository has no usable data yet. Under ExitOnNoData
// it aborts the process; under WaitForData it logs and returns, leaving Loaded()
// false so the refresh ticker keeps trying until the datasource comes back.
//
// Only reached after a refresh has already failed, so every case it reports is
// genuinely abnormal - a missing cache file on its own is not an error.
func (r *AbstractRepository[T]) noDataf(format string, a ...any) {
	if r.noDataPolicy == WaitForData {
		r.Errorf(format+" Repository is not loaded, waiting for it to appear...", a...)
		return
	}
	r.Fatalf(format+"\nCannot serve without repository. Exitting...", a...)
}

func (r *AbstractRepository[T]) loadCached() {
	file, err := os.Open(path.Join(r.cacheDir, r.ID))
	if err != nil {
		r.noDataf("Error opening cached repository: %v.", err)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil {
		r.noDataf("Error getting cached repository info: %v.", err)
		return
	}
	fileSize := stat.Size()
	if fileSize == 0 {
		r.noDataf("Cached repository is empty.")
		return
	}
	err = r.data.Init(file, nil)
	if err != nil {
		r.noDataf("Error init from cached repository: %v.", err)
		return
	}
	r.inited.Store(true)
	r.Infof("Loaded cached repository data: %d bytes, last modified: %v", fileSize, stat.ModTime())
}

func (r *AbstractRepository[T]) storeCached() {
	filePath := path.Join(r.cacheDir, r.ID)
	err := os.MkdirAll(r.cacheDir, 0755)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: cannot make dir: %v", filePath, err)
		return
	}
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: %v", filePath, err)
		return
	}
	defer file.Close()
	// file writer
	err = r.data.Store(file)
	if err != nil {
		r.Errorf("Cannot write cached repository to %s: %v", filePath, err)
		return
	}
	err = file.Sync()
	if err != nil {
		r.Errorf("Cannot write cached script to %s: %v", filePath, err)
		return
	}
}

func (r *AbstractRepository[T]) refresh(notify bool) {
	start := time.Now()
	var err error
	defer func() {
		if err != nil {
			r.Errorf("Error refreshing repository: %v", err)
			if !r.inited.Load() {
				if r.cacheDir != "" {
					r.loadCached()
				} else {
					r.noDataf("Cannot load cached repository: no CACHE_DIR is set.")
				}
			}
		} else {
			r.Debugf("Refreshed in %v", time.Now().Sub(start))
		}
	}()
	var tag any
	t := r.tag.Load()
	if t != nil {
		tag = *t
	}

	for i := 0; i < r.attempts; i++ {
		var reader io.ReadCloser
		var newTag any
		var modified bool
		reader, newTag, modified, err = r.dataSource(tag)
		if err != nil {
			r.Errorf("Attempt #%d Error loading repository from datasource: %v", i+1, err)
			time.Sleep(1 * time.Second)
			continue
		}
		if !modified {
			lastSuccess := time.Now()
			r.lastSuccess.Store(&lastSuccess)
			r.Debugf("Repository is not modified")
			return
		}
		defer reader.Close()
		err = r.data.Init(reader, newTag)
		if err != nil {
			r.Errorf("Attempt #%d Error init from datasource: %v", i+1, err)
			time.Sleep(1 * time.Second)
			continue
		}
		r.inited.Store(true)
		lastSuccess := time.Now()
		r.lastSuccess.Store(&lastSuccess)
		r.tag.Store(&newTag)
		if r.cacheDir != "" {
			r.storeCached()
		}
		r.Infof("Updated: %v previous: %v ms: %d", newTag, tag, time.Now().Sub(start).Milliseconds())
		if notify {
			select {
			case r.changesChan <- true:
				//notify listener if it is listening
			default:
			}
		}
		return
	}
}

func (r *AbstractRepository[T]) start() {
	safego.RunWithRestart(func() {
		if r.refreshPeriodSec > 0 {
			ticker := time.NewTicker(time.Duration(r.refreshPeriodSec) * time.Second)
			for {
				select {
				case <-ticker.C:
					r.refresh(true)
				case <-r.closed:
					ticker.Stop()
					return
				}
			}
		} else {
			// No refresh period configured — poll with a minimum interval to avoid busy-looping
			ticker := time.NewTicker(1 * time.Second)
			for {
				select {
				case <-ticker.C:
					r.refresh(true)
				case <-r.closed:
					ticker.Stop()
					return
				}
			}
		}
	})
}

func (r *AbstractRepository[T]) Close() error {
	close(r.closed)
	close(r.changesChan)
	return nil
}

func (r *AbstractRepository[T]) Loaded() bool {
	return r.inited.Load()
}

func (r *AbstractRepository[T]) LastSuccess() time.Time {
	t := r.lastSuccess.Load()
	if t == nil {
		return time.Time{}
	}
	return *t
}

func (r *AbstractRepository[T]) ChangesChannel() <-chan bool {
	return r.changesChan
}

func (r *AbstractRepository[T]) GetData() *T {
	return r.data.GetData()
}

func (r *AbstractRepository[T]) GetEtag() string {
	t := r.tag.Load()
	if t == nil {
		return ""
	}
	s, ok := (*t).(string)
	if ok {
		return s
	}
	return ""
}

func (r *AbstractRepository[T]) GetLastModified() time.Time {
	t := r.tag.Load()
	if t == nil {
		return time.Time{}
	}
	s, ok := (*t).(time.Time)
	if ok {
		return s
	}
	return time.Time{}
}
