package leveldb

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/safego"
	"io/ioutil"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultSegmentSize = 5 //50000 // Approximately ~100mb
	metaInfoFileName   = "meta.info"
	walSuffix          = ".wal"
)

var (
	errSegmentFull  = errors.New("Segment is full")
	errSegmentEmpty = errors.New("Segment is empty")
)

//MetaInfo is used for keeping state between queue reloads
type MetaInfo struct {
	CurrentSegment uint64 `json:"current_segment"`
	CurrentElement uint64 `json:"current_element"`
}

// Options for Segment
type Options struct {
	// Perms represents the datafiles modes and permission bits
	DirPerms  os.FileMode
	FilePerms os.FileMode
}

// DefaultOptions for Open().
var DefaultOptions = &Options{
	DirPerms:  0750, // Permissions for the created directories
	FilePerms: 0640, // Permissions for the created data files
}

//IQueue pushed elements to tail and pops elements from head
type IQueue struct {
	mutex *sync.RWMutex

	opts *Options

	dir string

	fileIDSequence uint64
	head           *Segment
	tail           *Segment

	segments []*Segment

	closed chan struct{}
}

//Open reads all opened segments from path or create the first one
func Open(dir string) (*IQueue, error) {
	q := &IQueue{
		mutex:  &sync.RWMutex{},
		opts:   DefaultOptions,
		dir:    dir,
		head:   nil,
		tail:   nil,
		closed: make(chan struct{}),
	}

	segments, lastFileID, err := loadSegments(dir, q.opts)
	if err != nil {
		return nil, err
	}

	if q.fileIDSequence < lastFileID {
		q.fileIDSequence = lastFileID
	}

	if len(segments) == 0 {
		segment, err := newSegment(q.dir, q.fileIDSequence, nil, q.opts)
		if err != nil {
			return nil, err
		}
		q.head = segment
		q.tail = segment
		q.segments = []*Segment{segment}
	} else {
		q.head = segments[0]
		q.tail = segments[len(segments)-1]
		q.segments = segments
	}

	safego.Run(q.PersistMetaInfo)

	return q, nil
}

func loadSegments(dir string, opts *Options) ([]*Segment, uint64, error) {
	filesInfo, err := ioutil.ReadDir(dir)
	if err != nil {
		return nil, 0, err
	}

	var fileNames []string
	for _, fi := range filesInfo {
		fileNames = append(fileNames, fi.Name())
	}

	sort.Strings(fileNames)

	var lastFileID uint64
	var segments []*Segment
	for _, f := range fileNames {
		if strings.HasSuffix(f, walSuffix) {
			fileIDInt, err := strconv.Atoi(strings.TrimSuffix(f, walSuffix))
			if err != nil {
				return nil, 0, err
			}

			fileID := uint64(fileIDInt)

			if fileID > lastFileID {
				lastFileID = fileID
			}

			//check order
			payload, err := ioutil.ReadFile(path.Join(dir, f))
			if err != nil {
				return nil, 0, err
			}

			objects, err := parsers.ParseJSONFile(payload)
			if err != nil {
				return nil, 0, err
			}

			s, err := newSegment(dir, fileID, objects, opts)
			if err != nil {
				return nil, 0, err
			}

			segments = append(segments, s)
		}
	}

	return segments, lastFileID, nil
}

func (q *IQueue) PersistMetaInfo() {
	ticker := time.NewTicker(time.Second)
	for {
		select {
		case <-q.closed:
			ticker.Stop()
			return
		case <-ticker.C:
			q.mutex.RLock()

			b, _ := json.Marshal(MetaInfo{
				CurrentSegment: q.head.fileID,
				CurrentElement: atomic.LoadUint64(&q.head.head),
			})
			f := path.Join(q.dir, metaInfoFileName)
			if err := ioutil.WriteFile(f, b, q.opts.FilePerms); err != nil {
				logging.SystemErrorf("error writing meta info file to %s: %v", f, err)
			}
			q.mutex.RUnlock()
		}
	}
}

func (q *IQueue) Enqueue(object map[string]interface{}) error {
	err := q.tail.push(object)
	if err != nil {
		if err == errSegmentFull {
			if err := q.createSegment(object); err != nil {
				return fmt.Errorf("error creating Segment: %v", err)
			}
		} else {
			return err
		}
	}
	return nil
}

func (q *IQueue) createSegment(object map[string]interface{}) error {
	q.mutex.Lock()
	defer q.mutex.Unlock()

	//check if tail has been already created while acquiring the lock
	if err := q.tail.push(object); err == nil {
		return nil
	}

	fileID := atomic.AddUint64(&q.fileIDSequence, 1)
	segment, err := newSegment(q.dir, fileID, []map[string]interface{}{object}, q.opts)
	if err != nil {
		return err
	}

	q.segments = append(q.segments, segment)
	q.tail = segment

	return nil
}

//DequeueBlock accepts only pointers
func (q *IQueue) DequeueBlock() (interface{}, error) {
	obj, err := q.dequeueBlock()
	return obj, err
}

func (q *IQueue) nextSegment() {
	q.mutex.Lock()

	for i, segment := range q.segments {
		if q.head.fileID != segment.fileID {
			q.head = segment
			//TODO archive or delete head in another goroutine
			q.segments = q.segments[i+1:]
		}
	}

	q.mutex.Unlock()
}

func (q *IQueue) dequeueBlock() (interface{}, error) {
	for {
		obj, err := q.head.pop()
		if err != nil {
			if err == errSegmentEmpty {
				q.nextSegment()
				continue
			}

			return nil, err
		}

		return obj, nil
	}
}

func (q *IQueue) Close() error {

	q.closed <- struct{}{}

	//TODO
	return nil
}
